import React, { useState } from 'react';
import { Newspaper, X, Star, Github } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import newsData from '../data/news.json';

interface NewsItem {
  id: string;
  date: string;
  title: string;
  body: string;
  tags: string[];
}

export const NewsPage: React.FC = () => {
  const { t } = useI18n();
  const [dismissedNews, setDismissedNews] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('ace-dismissed-news');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const allNews = newsData as NewsItem[];
  const activeNews = allNews.filter(n => !dismissedNews.has(n.id));
  const dismissed = allNews.filter(n => dismissedNews.has(n.id));

  const dismissNewsItem = (id: string) => {
    setDismissedNews(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('ace-dismissed-news', JSON.stringify([...next]));
      return next;
    });
  };

  const restoreNewsItem = (id: string) => {
    setDismissedNews(prev => {
      const next = new Set(prev);
      next.delete(id);
      localStorage.setItem('ace-dismissed-news', JSON.stringify([...next]));
      return next;
    });
  };

  const tagColor = (tag: string) => {
    switch (tag) {
      case 'experimental':
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
      case 'backend':
        return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
      case 'training':
        return 'bg-purple-500/15 text-purple-600 dark:text-purple-400';
      case 'feature':
        return 'bg-green-500/15 text-green-600 dark:text-green-400';
      case 'bugfix':
        return 'bg-red-500/15 text-red-600 dark:text-red-400';
      default:
        return 'bg-zinc-200 dark:bg-white/10 text-zinc-500 dark:text-zinc-400';
    }
  };

  const renderCard = (item: NewsItem, isDismissed: boolean) => (
    <div
      key={item.id}
      className={`
        group rounded-2xl border transition-all duration-200
        ${isDismissed
          ? 'bg-zinc-100 dark:bg-white/[0.02] border-zinc-200 dark:border-white/5 opacity-50'
          : 'bg-white dark:bg-suno-card border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10'
        }
      `}
    >
      <div className="p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
              {item.title}
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{item.date}</p>
          </div>
          {!isDismissed ? (
            <button
              onClick={() => dismissNewsItem(item.id)}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 transition-all flex-shrink-0"
              title="Dismiss"
            >
              <X size={16} />
            </button>
          ) : (
            <button
              onClick={() => restoreNewsItem(item.id)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline transition-colors flex-shrink-0"
            >
              Restore
            </button>
          )}
        </div>

        {/* Body */}
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-3 leading-relaxed">
          {item.body}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {item.tags.map(tag => (
            <span
              key={tag}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${tagColor(tag)}`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 bg-white dark:bg-black overflow-y-auto p-6 lg:p-10 pb-32 transition-colors duration-300">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <Newspaper size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('news')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Updates and announcements</p>
          </div>
        </div>

        {/* Star Repo */}
        <a
          href="https://github.com/audiohacking/acestep-cpp-ui"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 mb-8 px-5 py-4 rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-suno-card hover:border-zinc-300 dark:hover:border-white/10 transition-all group"
        >
          <Github size={20} className="text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">fspecii/ace-step-ui</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Star the repo to support the project</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 text-sm font-medium group-hover:bg-amber-500/15 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors flex-shrink-0">
            <Star size={14} />
            Star
          </div>
        </a>

        {/* Active News */}
        {activeNews.length > 0 ? (
          <div className="space-y-4">
            {activeNews.map(item => renderCard(item, false))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Newspaper size={48} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">No new updates</p>
          </div>
        )}

        {/* Dismissed News */}
        {dismissed.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-4">
              Dismissed
            </h2>
            <div className="space-y-3">
              {dismissed.map(item => renderCard(item, true))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
