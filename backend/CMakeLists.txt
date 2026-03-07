cmake_minimum_required(VERSION 3.16)
project(acestep-cpp-server VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -----------------------------------------------------------------------
# Dependencies via FetchContent (header-only, no install required)
# -----------------------------------------------------------------------
include(FetchContent)

# cpp-httplib — single-header HTTP/HTTPS server & client
FetchContent_Declare(
  httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG        v0.18.3
)
FetchContent_MakeAvailable(httplib)

# nlohmann/json — single-header JSON library
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
)
set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(nlohmann_json)

# -----------------------------------------------------------------------
# acestep-cpp as a subdirectory (place the repo next to this project or
# set ACESTEP_CPP_DIR to override the location)
# -----------------------------------------------------------------------
if(NOT DEFINED ACESTEP_CPP_DIR)
  set(ACESTEP_CPP_DIR "${CMAKE_SOURCE_DIR}/../acestep.cpp"
      CACHE PATH "Path to the acestep.cpp source tree")
endif()

# -----------------------------------------------------------------------
# Server executable
# -----------------------------------------------------------------------
add_executable(acestep-server src/main.cpp)

target_include_directories(acestep-server PRIVATE
  ${httplib_SOURCE_DIR}
  ${nlohmann_json_SOURCE_DIR}/include
)

target_link_libraries(acestep-server PRIVATE
  httplib::httplib
  nlohmann_json::nlohmann_json
)

# Link acestep.cpp if available as a library target
if(TARGET acestep)
  target_link_libraries(acestep-server PRIVATE acestep)
  target_compile_definitions(acestep-server PRIVATE HAVE_ACESTEP_LIB)
endif()

# Platform-specific thread support
find_package(Threads REQUIRED)
target_link_libraries(acestep-server PRIVATE Threads::Threads)

# -----------------------------------------------------------------------
# Install targets
# -----------------------------------------------------------------------
include(GNUInstallDirs)
install(TARGETS acestep-server
        RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})

# -----------------------------------------------------------------------
# Build info
# -----------------------------------------------------------------------
message(STATUS "")
message(STATUS "  acestep-cpp server configuration")
message(STATUS "  ---------------------------------")
message(STATUS "  C++ standard  : ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build type    : ${CMAKE_BUILD_TYPE}")
message(STATUS "  Install prefix: ${CMAKE_INSTALL_PREFIX}")
message(STATUS "  acestep.cpp   : ${ACESTEP_CPP_DIR}")
message(STATUS "")
