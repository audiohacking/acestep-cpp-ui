/**
 * acestep-cpp HTTP server
 *
 * Wraps the acestep-cpp music generation binary (or library) and exposes a
 * REST API that the Node.js Express backend calls for every generation job.
 *
 * Endpoints
 * ---------
 *   GET  /health                – liveness probe
 *   GET  /v1/models             – list available GGUF models
 *   POST /v1/init               – switch active model
 *   POST /v1/generate           – start synchronous generation, returns audio paths
 *   GET  /v1/audio?path=<p>     – stream a generated audio file
 *   POST /v1/lora/load          – load a LoRA adapter
 *   POST /v1/lora/unload        – unload the current LoRA adapter
 *   POST /v1/lora/scale         – set LoRA influence scale (0.0 – 1.0)
 *   POST /v1/lora/toggle        – enable / disable LoRA
 *   GET  /v1/lora/status        – query LoRA state
 *   POST /format_input          – rewrite prompt/lyrics via LLM
 *   GET  /v1/limits             – GPU capability limits
 *
 * Configuration (environment variables)
 * --------------------------------------
 *   ACESTEP_BIN   Path to the acestep-generate binary
 *                 Default: ./acestep-generate (next to the server binary)
 *   ACESTEP_MODEL Path to the default GGUF model file
 *                 Default: ./models/acestep-v15-turbo.gguf
 *   AUDIO_DIR     Directory where generated audio files are written
 *                 Default: ./audio
 *   SERVER_PORT   Port to listen on
 *                 Default: 7860
 *   STATIC_DIR    Directory of pre-built frontend assets (optional)
 *                 Default: ../dist  (relative to the server binary)
 */

#include <httplib.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string env(const char* key, const char* fallback)
{
    const char* v = std::getenv(key);
    return v ? v : fallback;
}

static std::string generate_id()
{
    static std::mt19937_64 rng{std::random_device{}()};
    std::uniform_int_distribution<uint64_t> dist;
    std::ostringstream ss;
    ss << "job_" << std::hex << dist(rng);
    return ss.str();
}

static std::string mime_for(const std::string& path)
{
    if (path.size() >= 5 && path.substr(path.size() - 5) == ".flac") return "audio/flac";
    if (path.size() >= 4 && path.substr(path.size() - 4) == ".wav")  return "audio/wav";
    if (path.size() >= 4 && path.substr(path.size() - 4) == ".ogg")  return "audio/ogg";
    return "audio/mpeg";
}

// Shell-escape a single argument (POSIX)
static std::string shell_quote(const std::string& s)
{
    std::string out = "'";
    for (char c : s) {
        if (c == '\'') out += "'\\''";
        else           out += c;
    }
    return out + "'";
}

// ---------------------------------------------------------------------------
// Global configuration
// ---------------------------------------------------------------------------

static std::string g_bin;        // path to acestep-generate binary
static std::string g_model;      // active model path / name
static std::string g_audio_dir;  // where to write generated audio

// ---------------------------------------------------------------------------
// LoRA state
// ---------------------------------------------------------------------------

struct LoraState {
    bool        loaded = false;
    bool        active = false;
    float       scale  = 1.0f;
    std::string path;
};

static LoraState  g_lora;
static std::mutex g_lora_mutex;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Build and run the acestep-generate command synchronously.
 * Returns the list of output audio file paths on success, or throws on error.
 */
static std::vector<std::string> run_generation(const json& params)
{
    fs::create_directories(g_audio_dir);

    // Unique output prefix inside audio_dir
    std::string job_id = generate_id();
    std::string out_prefix = (fs::path(g_audio_dir) / job_id).string();

    // Build command
    std::ostringstream cmd;
    cmd << g_bin;

    // Model
    cmd << " --model " << shell_quote(g_model);

    // Prompt / lyrics
    if (params.contains("prompt"))
        cmd << " --prompt " << shell_quote(params["prompt"].get<std::string>());
    if (params.contains("lyrics") && !params["lyrics"].get<std::string>().empty())
        cmd << " --lyrics " << shell_quote(params["lyrics"].get<std::string>());

    // Music parameters
    if (params.contains("duration") && params["duration"].get<int>() > 0)
        cmd << " --duration " << params["duration"].get<int>();
    if (params.contains("bpm") && params["bpm"].get<int>() > 0)
        cmd << " --bpm " << params["bpm"].get<int>();
    if (params.contains("key_scale") && !params["key_scale"].get<std::string>().empty())
        cmd << " --key-scale " << shell_quote(params["key_scale"].get<std::string>());
    if (params.contains("time_signature") && !params["time_signature"].get<std::string>().empty())
        cmd << " --time-signature " << shell_quote(params["time_signature"].get<std::string>());
    if (params.contains("vocal_language") && !params["vocal_language"].get<std::string>().empty())
        cmd << " --vocal-language " << shell_quote(params["vocal_language"].get<std::string>());

    // Generation settings
    if (params.contains("infer_steps"))
        cmd << " --infer-steps " << params["infer_steps"].get<int>();
    if (params.contains("guidance_scale"))
        cmd << " --guidance-scale " << params["guidance_scale"].get<double>();
    if (params.contains("batch_size"))
        cmd << " --batch-size " << params["batch_size"].get<int>();
    if (params.contains("seed") && params["seed"].get<int>() >= 0)
        cmd << " --seed " << params["seed"].get<int>();
    if (params.contains("audio_format"))
        cmd << " --audio-format " << shell_quote(params["audio_format"].get<std::string>());
    if (params.contains("shift"))
        cmd << " --shift " << params["shift"].get<double>();
    if (params.contains("infer_method"))
        cmd << " --infer-method " << shell_quote(params["infer_method"].get<std::string>());
    if (params.contains("instrumental") && params["instrumental"].get<bool>())
        cmd << " --instrumental";

    // Task type / audio cover
    if (params.contains("task_type") && params["task_type"].get<std::string>() != "text2music")
        cmd << " --task-type " << shell_quote(params["task_type"].get<std::string>());
    if (params.contains("reference_audio") && !params["reference_audio"].get<std::string>().empty())
        cmd << " --reference-audio " << shell_quote(params["reference_audio"].get<std::string>());
    if (params.contains("src_audio") && !params["src_audio"].get<std::string>().empty())
        cmd << " --src-audio " << shell_quote(params["src_audio"].get<std::string>());
    if (params.contains("audio_cover_strength"))
        cmd << " --audio-cover-strength " << params["audio_cover_strength"].get<double>();
    if (params.contains("repainting_start") && params["repainting_start"].get<double>() > 0.0)
        cmd << " --repainting-start " << params["repainting_start"].get<double>();
    if (params.contains("repainting_end") && params["repainting_end"].get<double>() > 0.0)
        cmd << " --repainting-end " << params["repainting_end"].get<double>();
    if (params.contains("audio_codes") && !params["audio_codes"].get<std::string>().empty())
        cmd << " --audio-codes " << shell_quote(params["audio_codes"].get<std::string>());

    // LM / CoT parameters
    if (params.contains("thinking") && params["thinking"].get<bool>())
        cmd << " --thinking";
    if (params.contains("lm_temperature"))
        cmd << " --lm-temperature " << params["lm_temperature"].get<double>();
    if (params.contains("lm_cfg_scale"))
        cmd << " --lm-cfg-scale " << params["lm_cfg_scale"].get<double>();
    if (params.contains("lm_top_k") && params["lm_top_k"].get<int>() > 0)
        cmd << " --lm-top-k " << params["lm_top_k"].get<int>();
    if (params.contains("lm_top_p"))
        cmd << " --lm-top-p " << params["lm_top_p"].get<double>();
    if (params.contains("lm_negative_prompt") && !params["lm_negative_prompt"].get<std::string>().empty())
        cmd << " --lm-negative-prompt " << shell_quote(params["lm_negative_prompt"].get<std::string>());

    // LoRA (apply if loaded and active)
    {
        std::lock_guard<std::mutex> lock(g_lora_mutex);
        if (g_lora.loaded && g_lora.active && !g_lora.path.empty()) {
            cmd << " --lora " << shell_quote(g_lora.path);
            cmd << " --lora-scale " << g_lora.scale;
        }
    }

    // Output
    cmd << " --output-prefix " << shell_quote(out_prefix);
    cmd << " --json";  // request JSON summary on stdout

    std::string full_cmd = cmd.str();
    std::cerr << "[acestep-server] Running: " << full_cmd << "\n";

    // Execute
    FILE* pipe = popen((full_cmd + " 2>&1").c_str(), "r");
    if (!pipe) throw std::runtime_error("Failed to spawn acestep-generate");

    std::string output;
    char buf[4096];
    while (fgets(buf, sizeof(buf), pipe)) output += buf;
    int exit_code = pclose(pipe);

    if (exit_code != 0)
        throw std::runtime_error("acestep-generate exited with code " + std::to_string(exit_code) + ": " + output);

    // Parse JSON output produced by these.cpp (expected format):
    // { "audio_paths": ["path/to/file.mp3", ...], "bpm": 120, ... }
    // Also accept a plain newline-delimited JSON object.
    json result;
    std::istringstream iss(output);
    std::string line;
    while (std::getline(iss, line)) {
        if (!line.empty() && line.front() == '{') {
            try { result = json::parse(line); break; } catch (...) {}
        }
    }

    // Collect generated files
    std::vector<std::string> audio_paths;

    if (result.contains("audio_paths") && result["audio_paths"].is_array()) {
        for (const auto& p : result["audio_paths"])
            audio_paths.push_back(p.get<std::string>());
    } else {
        // Fallback: scan audio_dir for files matching the job prefix
        const std::string audio_ext[] = {".mp3", ".flac", ".wav", ".ogg"};
        for (const auto& entry : fs::directory_iterator(g_audio_dir)) {
            std::string fname = entry.path().filename().string();
            if (fname.rfind(job_id, 0) == 0) {
                std::string ext = entry.path().extension().string();
                for (const auto& e : audio_ext) {
                    if (ext == e) { audio_paths.push_back(entry.path().string()); break; }
                }
            }
        }
    }

    if (audio_paths.empty())
        throw std::runtime_error("Generation succeeded but no audio files were produced");

    return audio_paths;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

int main()
{
    g_bin       = env("ACESTEP_BIN",   "./acestep-generate");
    g_model     = env("ACESTEP_MODEL", "./models/acestep-v15-turbo.gguf");
    g_audio_dir = env("AUDIO_DIR",     "./audio");
    int port    = std::stoi(env("SERVER_PORT", "7860"));
    std::string static_dir = env("STATIC_DIR", "../dist");

    std::cout << "[acestep-server] Starting on port " << port << "\n";
    std::cout << "[acestep-server] Binary  : " << g_bin       << "\n";
    std::cout << "[acestep-server] Model   : " << g_model     << "\n";
    std::cout << "[acestep-server] Audio   : " << g_audio_dir << "\n";

    httplib::Server svr;

    // ------------------------------------------------------------------
    // Health
    // ------------------------------------------------------------------
    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        json body = { {"status", "ok"}, {"service", "acestep-cpp"} };
        res.set_content(body.dump(), "application/json");
    });

    // ------------------------------------------------------------------
    // GET /v1/models
    // ------------------------------------------------------------------
    svr.Get("/v1/models", [](const httplib::Request&, httplib::Response& res) {
        json models = json::array();
        models.push_back({ {"name", g_model}, {"is_active", true}, {"is_preloaded", true} });
        json body = { {"models", models} };
        res.set_content(body.dump(), "application/json");
    });

    // ------------------------------------------------------------------
    // POST /v1/init  – switch active model
    // ------------------------------------------------------------------
    svr.Post("/v1/init", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto params = json::parse(req.body);
            if (params.contains("model"))
                g_model = params["model"].get<std::string>();
            json body = { {"status", "ok"}, {"model", g_model} };
            res.set_content(body.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // ------------------------------------------------------------------
    // GET /v1/limits – GPU capability limits
    // ------------------------------------------------------------------
    svr.Get("/v1/limits", [](const httplib::Request&, httplib::Response& res) {
        // These are conservative defaults; a real implementation would query
        // the GPU via ggml / CUDA APIs.
        json body = {
            {"tier",                       "medium"},
            {"gpu_memory_gb",              8},
            {"max_duration_with_lm",       120},
            {"max_duration_without_lm",    240},
            {"max_batch_size_with_lm",     2},
            {"max_batch_size_without_lm",  4},
        };
        res.set_content(body.dump(), "application/json");
    });

    // ------------------------------------------------------------------
    // POST /v1/generate
    // ------------------------------------------------------------------
    svr.Post("/v1/generate", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto params = json::parse(req.body);
            auto audio_paths = run_generation(params);
            json body = { {"audio_paths", audio_paths} };
            res.set_content(body.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // ------------------------------------------------------------------
    // GET /v1/audio?path=<absolute-path>  – stream a generated audio file
    // ------------------------------------------------------------------
    svr.Get("/v1/audio", [](const httplib::Request& req, httplib::Response& res) {
        auto it = req.params.find("path");
        if (it == req.params.end()) {
            res.status = 400;
            res.set_content(json{{"error", "path parameter required"}}.dump(), "application/json");
            return;
        }
        std::string path = it->second;
        if (!fs::exists(path)) {
            res.status = 404;
            res.set_content(json{{"error", "file not found"}}.dump(), "application/json");
            return;
        }
        std::ifstream file(path, std::ios::binary);
        std::string content((std::istreambuf_iterator<char>(file)),
                             std::istreambuf_iterator<char>());
        res.set_content(content, mime_for(path));
    });

    // ------------------------------------------------------------------
    // LoRA endpoints
    // ------------------------------------------------------------------
    svr.Post("/v1/lora/load", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto params = json::parse(req.body);
            std::string lora_path = params.value("lora_path", "");
            if (lora_path.empty()) {
                res.status = 400;
                res.set_content(json{{"error", "lora_path required"}}.dump(), "application/json");
                return;
            }
            std::lock_guard<std::mutex> lock(g_lora_mutex);
            g_lora = { true, true, g_lora.scale, lora_path };
            res.set_content(json{{"message", "LoRA loaded"}, {"lora_path", lora_path}}.dump(),
                            "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    svr.Post("/v1/lora/unload", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(g_lora_mutex);
        g_lora = { false, false, 1.0f, "" };
        res.set_content(json{{"message", "LoRA unloaded"}}.dump(), "application/json");
    });

    svr.Post("/v1/lora/scale", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto params = json::parse(req.body);
            float scale = params.value("scale", 1.0f);
            std::lock_guard<std::mutex> lock(g_lora_mutex);
            g_lora.scale = scale;
            res.set_content(json{{"message", "LoRA scale updated"}, {"scale", scale}}.dump(),
                            "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    svr.Post("/v1/lora/toggle", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto params = json::parse(req.body);
            bool enabled = params.value("enabled", true);
            std::lock_guard<std::mutex> lock(g_lora_mutex);
            g_lora.active = enabled;
            std::string msg = enabled ? "LoRA enabled" : "LoRA disabled";
            res.set_content(json{{"message", msg}, {"active", enabled}}.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    svr.Get("/v1/lora/status", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(g_lora_mutex);
        json body = {
            {"loaded", g_lora.loaded},
            {"active", g_lora.active},
            {"scale",  g_lora.scale},
            {"path",   g_lora.path},
        };
        res.set_content(body.dump(), "application/json");
    });

    // ------------------------------------------------------------------
    // POST /format_input  – rewrite prompt/lyrics via LLM
    // ------------------------------------------------------------------
    svr.Post("/format_input", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto params = json::parse(req.body);
            std::string prompt = params.value("prompt", "");
            std::string lyrics = params.value("lyrics", "");

            // Build command for the LLM format companion
            std::ostringstream cmd;
            cmd << g_bin << " --mode format";
            cmd << " --prompt " << shell_quote(prompt);
            if (!lyrics.empty())
                cmd << " --lyrics " << shell_quote(lyrics);
            if (params.contains("temperature"))
                cmd << " --temperature " << params["temperature"].get<double>();
            cmd << " --json";

            FILE* pipe = popen((cmd.str() + " 2>&1").c_str(), "r");
            if (!pipe) throw std::runtime_error("Failed to spawn formatter");

            std::string output;
            char buf[4096];
            while (fgets(buf, sizeof(buf), pipe)) output += buf;
            int exit_code = pclose(pipe);

            if (exit_code != 0)
                throw std::runtime_error("Formatter exited with code " +
                                         std::to_string(exit_code) + ": " + output);

            // Parse JSON output
            std::istringstream iss(output);
            std::string line;
            while (std::getline(iss, line)) {
                if (!line.empty() && line.front() == '{') {
                    try {
                        auto result = json::parse(line);
                        res.set_content(result.dump(), "application/json");
                        return;
                    } catch (...) {}
                }
            }
            throw std::runtime_error("No JSON output from formatter: " + output);
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // ------------------------------------------------------------------
    // Serve pre-built React frontend (production mode)
    // ------------------------------------------------------------------
    if (fs::exists(static_dir)) {
        svr.set_mount_point("/", static_dir);
        std::cout << "[acestep-server] Serving frontend from: " << static_dir << "\n";
    }

    // ------------------------------------------------------------------
    // Listen
    // ------------------------------------------------------------------
    std::cout << "[acestep-server] Listening on http://0.0.0.0:" << port << "\n";
    svr.listen("0.0.0.0", port);

    return 0;
}
