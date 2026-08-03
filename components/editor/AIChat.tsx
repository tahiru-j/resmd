'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  BrainIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  CopyIcon,
  EraserIcon,
  PaperclipIcon,
  PaperPlaneTiltIcon,
  SpinnerIcon,
  XIcon,
} from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import { parseSuggestion, type Edit } from '@/lib/prompts';
import { loadSelectedModel, saveSelectedModel } from '@/lib/ai';

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  use_count?: number;
}

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: 'text-purple-400 bg-purple-400/10',
  groq: 'text-orange-400 bg-orange-400/10',
  openai: 'text-green-400 bg-green-400/10',
  anthropic: 'text-amber-400 bg-amber-400/10',
  'google gemini': 'text-blue-400 bg-blue-400/10',
};

const FREE_TIER_PROVIDERS = new Set(['openrouter', 'groq']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  role: 'user' | 'assistant';
  prose: string;
  editCount: number;
  fullResume?: string;
  model?: string;
  attachmentName?: string;
}

interface AttachedFile {
  name: string;
  text: string;
}

interface AIChatProps {
  resumeContent: string;
  onEditsReceived?: (edits: Edit[], model?: string) => void;
  onReplaceResume?: (content: string) => void;
  isGuest?: boolean;
  expanded?: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AIChat({
  resumeContent,
  onEditsReceived,
  onReplaceResume,
  isGuest = false,
  expanded = false,
}: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedProviderId, setSelectedProviderId] =
    useState<string>('server');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(
    new Set()
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachChoiceRef = useRef<HTMLDivElement>(null);

  // Load persisted model selection and fetch available models
  useEffect(() => {
    const saved = loadSelectedModel();
    if (saved) {
      setSelectedModelId(saved.modelId);
      setSelectedProviderId(saved.providerId);
    }

    fetch('/api/ai/models')
      .then((r) => r.json())
      .then((data) => {
        if (data.models?.length) {
          setModels(data.models);
          const providers = new Set<string>(
            data.models.map((m: ModelOption) => m.provider)
          );
          setCollapsedProviders(providers);
          const savedStillValid =
            saved &&
            data.models.some(
              (m: ModelOption) =>
                m.id === saved.modelId && m.providerId === saved.providerId
            );
          if (!savedStillValid) {
            const first = data.models[0];
            setSelectedModelId(first.id);
            setSelectedProviderId(first.providerId ?? 'server');
            saveSelectedModel({
              modelId: first.id,
              providerId: first.providerId ?? 'server',
            });
          }
        }
      })
      .catch(() => {
        // Silently fail — server env model will be used as fallback
      });
  }, []);

  // Close model picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        pickerTriggerRef.current &&
        !pickerTriggerRef.current.contains(e.target as Node)
      ) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelPicker]);

  // Close attach choice on outside click
  useEffect(() => {
    if (!pendingFile) return;
    const handler = (e: MouseEvent) => {
      if (
        attachChoiceRef.current &&
        !attachChoiceRef.current.contains(e.target as Node) &&
        fileInputRef.current &&
        !fileInputRef.current.contains(e.target as Node)
      ) {
        setPendingFile(null);
        setAttachError(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pendingFile]);

  const handleModelChange = (id: string, provId: string) => {
    setSelectedModelId(id);
    setSelectedProviderId(provId);
    saveSelectedModel({ modelId: id, providerId: provId });
    setShowModelPicker(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setAttachError(null);
    // Reset so same file can be re-selected if dismissed
    e.target.value = '';
  };

  const handleConvertToResmd = async () => {
    if (!pendingFile) return;
    setAttachLoading(true);
    setAttachError(null);
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      onReplaceResume?.(data.rawContent);
      setPendingFile(null);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setAttachLoading(false);
    }
  };

  const handleAddAsContext = async () => {
    if (!pendingFile) return;
    setAttachLoading(true);
    setAttachError(null);
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      const res = await fetch('/api/import/extract', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Extraction failed');
      setAttachedFile({ name: pendingFile.name, text: data.text });
      setPendingFile(null);
      inputRef.current?.focus();
    } catch (err) {
      setAttachError(
        err instanceof Error ? err.message : 'Failed to read file'
      );
    } finally {
      setAttachLoading(false);
    }
  };

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input after AI finishes responding
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const send = async (overrideText?: string, historyOverride?: Message[]) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    const history = historyOverride ?? messages;
    // Capture and clear attached file before the async send
    const currentAttachment = attachedFile;
    if (currentAttachment) setAttachedFile(null);

    const userMsg: Message = {
      role: 'user',
      prose: text,
      editCount: 0,
      attachmentName: currentAttachment?.name,
    };
    const next = [...history, userMsg];
    setMessages(next);
    if (!overrideText) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          resumeContent,
          // Send only prose for history — the full resume is always in the preamble.
          // Replace empty prose (edit-only turns) with a placeholder so providers
          // don't reject empty-string content.
          history: history.map((m) => ({
            role: m.role,
            content: m.prose || '✦',
          })),
          model: selectedModelId || undefined,
          providerId: selectedProviderId || undefined,
          ...(currentAttachment
            ? {
                fileContext: currentAttachment.text,
                fileName: currentAttachment.name,
              }
            : {}),
        }),
      });

      if (res.status === 429) {
        const after = res.headers.get('Retry-After');
        setMessages([
          ...next,
          {
            role: 'assistant',
            prose: `Slow down — try again${after ? ` in ${after}s` : ' in a moment'}.`,
            editCount: 0,
          },
        ]);
        return;
      }

      const data = await res.json();
      if (data.reply) {
        const { prose, edits, fullResume } = parseSuggestion(data.reply);
        if (edits.length > 0) {
          onEditsReceived?.(edits, selectedModelId || undefined);
        }
        setMessages([
          ...next,
          {
            role: 'assistant',
            prose,
            editCount: edits.length,
            fullResume,
            model: selectedModelId || undefined,
          },
        ]);
      } else {
        setMessages([
          ...next,
          {
            role: 'assistant',
            prose: 'Something went wrong. Please try another model.',
            editCount: 0,
          },
        ]);
      }
    } catch {
      setMessages([
        ...next,
        {
          role: 'assistant',
          prose: 'Failed to reach the AI. Check your connection.',
          editCount: 0,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleRetry = (msgIdx: number, text: string) => {
    send(text, messages.slice(0, msgIdx));
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const activeModel =
    models.find(
      (m) => m.id === selectedModelId && m.providerId === selectedProviderId
    ) ?? models.find((m) => m.id === selectedModelId);

  // Keep input focused whenever the user interacts with non-interactive chat areas
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('button, input, textarea, a, select')) {
      inputRef.current?.focus();
    }
  };

  if (isGuest) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border bg-editor-bg flex-shrink-0 text-xs">
        <span className="flex items-center gap-1.5 text-faint">
          <span className="text-accent">✦</span>
          AI Assistant
        </span>
        <span className="text-muted">
          <a
            href="/auth?signup=1"
            className="text-accent hover:underline font-medium"
          >
            Create a free account
          </a>{' '}
          to use AI features
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col border-t border-border bg-editor-bg ${expanded ? 'flex-1 min-h-0' : 'flex-shrink-0'}`}
      onClick={handleContainerClick}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Message history */}
      {messages.length > 0 && (
        <div
          ref={historyRef}
          className={`overflow-y-auto overflow-x-hidden px-4 py-3 flex flex-col gap-3 ${expanded ? 'flex-1' : ''}`}
          style={expanded ? undefined : { maxHeight: '300px' }}
        >
          {messages.map((msg, mi) => (
            <div
              key={mi}
              className={`group flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.prose && (
                <div
                  className={`text-sm rounded-xl px-3 py-1.5 max-w-[90%] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-accent text-accent-text whitespace-pre-wrap'
                      : 'bg-surface text-text border border-border'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <span>
                      {msg.prose}
                      {msg.attachmentName && (
                        <span className="flex items-center gap-1 mt-1.5 text-[10px] text-accent-text/70">
                          <PaperclipIcon size={9} />
                          {msg.attachmentName}
                        </span>
                      )}
                    </span>
                  ) : (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => (
                          <p className="mb-1.5 last:mb-0">{children}</p>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-semibold text-text">
                            {children}
                          </strong>
                        ),
                        em: ({ children }) => (
                          <em className="italic text-muted">{children}</em>
                        ),
                        ul: ({ children }) => (
                          <ul className="mb-1.5 pl-4 flex flex-col gap-0.5 list-disc">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mb-1.5 pl-4 flex flex-col gap-0.5 list-decimal">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="text-sm">{children}</li>
                        ),
                        code: ({ children }) => (
                          <code className="font-mono text-xs bg-surface-2 px-1 py-0.5 rounded">
                            {children}
                          </code>
                        ),
                        h1: ({ children }) => (
                          <p className="font-semibold mb-1">{children}</p>
                        ),
                        h2: ({ children }) => (
                          <p className="font-semibold mb-1">{children}</p>
                        ),
                        h3: ({ children }) => (
                          <p className="font-medium mb-0.5">{children}</p>
                        ),
                      }}
                    >
                      {msg.prose}
                    </ReactMarkdown>
                  )}
                </div>
              )}

              {msg.fullResume && (
                <FullResumeCard
                  content={msg.fullResume}
                  onApply={() => onReplaceResume?.(msg.fullResume!)}
                />
              )}

              {msg.role === 'assistant' && msg.editCount > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-faint">
                  <span className="text-accent" aria-hidden>
                    ✦
                  </span>
                  <span>
                    {msg.editCount} edit{msg.editCount !== 1 ? 's' : ''} shown
                    in editor
                  </span>
                </div>
              )}

              {msg.role === 'user' && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <button
                    onClick={() => handleCopy(msg.prose, mi)}
                    className="p-1 rounded text-faint hover:text-text hover:bg-surface-2 transition-colors duration-150"
                    title="Copy"
                  >
                    {copiedIdx === mi ? (
                      <CheckIcon size={11} weight="bold" />
                    ) : (
                      <CopyIcon size={11} />
                    )}
                  </button>
                  <button
                    onClick={() => handleRetry(mi, msg.prose)}
                    disabled={loading}
                    className="p-1 rounded text-faint hover:text-text hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
                    title="Retry"
                  >
                    <ArrowCounterClockwiseIcon size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex flex-col gap-0.5 items-start">
              <div className="text-sm rounded-xl px-3 py-1.5 bg-surface border border-border text-muted">
                <ThinkingDots />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input card */}
      <div className="px-3 pb-3 pt-1.5">
        <div
          className={`relative rounded-2xl border bg-surface transition-colors duration-150 ${
            pendingFile
              ? 'border-accent/50'
              : 'border-border focus-within:border-accent/30'
          }`}
        >
          {/* Attach choice popover */}
          {pendingFile && (
            <div
              ref={attachChoiceRef}
              className="absolute bottom-full left-0 mb-2 w-72 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden z-50"
            >
              <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                <PaperclipIcon size={12} className="text-muted flex-shrink-0" />
                <span className="text-xs font-medium text-text truncate flex-1">
                  {pendingFile.name}
                </span>
                <button
                  onClick={() => {
                    setPendingFile(null);
                    setAttachError(null);
                  }}
                  className="text-faint hover:text-text transition-colors flex-shrink-0"
                >
                  <XIcon size={12} weight="bold" />
                </button>
              </div>
              {attachError ? (
                <div className="px-3 py-3 text-xs text-red-400">
                  {attachError}
                </div>
              ) : (
                <div className="p-2 flex flex-col gap-1.5">
                  <button
                    onClick={handleConvertToResmd}
                    disabled={attachLoading}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-start gap-2.5"
                  >
                    <span className="text-accent mt-0.5 flex-shrink-0">✦</span>
                    <div>
                      <div className="text-xs font-medium text-text">
                        Convert to resmd
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        Replace the editor content with an AI-converted version
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={handleAddAsContext}
                    disabled={attachLoading}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-start gap-2.5"
                  >
                    <PaperclipIcon
                      size={13}
                      className="text-muted mt-0.5 flex-shrink-0"
                    />
                    <div>
                      <div className="text-xs font-medium text-text">
                        Add as AI context
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        Let the AI read this file when answering your next
                        message
                      </div>
                    </div>
                  </button>
                  {attachLoading && (
                    <div className="flex items-center justify-center py-2 gap-2 text-xs text-muted">
                      <SpinnerIcon size={12} className="animate-spin" />
                      Processing…
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Attached file chip — inside card */}
          {attachedFile && (
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent min-w-0">
                <PaperclipIcon size={11} className="flex-shrink-0" />
                <span className="truncate max-w-[200px]">
                  {attachedFile.name}
                </span>
                <button
                  onClick={() => setAttachedFile(null)}
                  className="flex-shrink-0 text-accent/60 hover:text-accent transition-colors ml-0.5"
                  title="Remove"
                >
                  <XIcon size={10} weight="bold" />
                </button>
              </div>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Ask AI to improve your resume…"
            disabled={loading}
            className="w-full bg-transparent text-sm text-text placeholder:text-faint outline-none disabled:opacity-50 resize-none overflow-y-auto leading-5 px-4 pt-3 pb-2 max-h-48 min-h-[2.75rem]"
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
            {/* Left: attach + model + clear */}
            <div className="flex items-center gap-0.5">
              {/* Attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                title="Attach file (.pdf .docx .txt .md)"
                className={`p-2 rounded-xl transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${
                  attachedFile
                    ? 'text-accent bg-accent/10 hover:bg-accent/20'
                    : 'text-muted hover:text-text hover:bg-surface-2'
                }`}
              >
                <PaperclipIcon size={15} />
              </button>

              {/* Model picker */}
              <div className="relative">
                {showModelPicker && (
                  <div
                    ref={pickerRef}
                    className="absolute bottom-full mb-2 left-0 w-72 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden z-50"
                  >
                    <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
                      <span className="text-xs font-semibold text-text">
                        Select model
                      </span>
                      <a
                        href="/settings"
                        className="text-[10px] text-accent hover:underline"
                      >
                        + Add provider
                      </a>
                    </div>

                    {models.length === 0 ? (
                      <p className="text-xs text-faint text-center py-6 px-4">
                        No models —{' '}
                        <a
                          href="/settings"
                          className="text-accent hover:underline"
                        >
                          add a provider
                        </a>
                      </p>
                    ) : (
                      (() => {
                        const byok = models.filter(
                          (m) => m.providerId !== 'server'
                        );
                        const server = models.filter(
                          (m) => m.providerId === 'server'
                        );
                        const ordered = [...byok, ...server];
                        const groups = new Map<string, ModelOption[]>();
                        for (const m of ordered) {
                          if (!groups.has(m.provider))
                            groups.set(m.provider, []);
                          groups.get(m.provider)!.push(m);
                        }
                        return (
                          <div
                            className="overflow-y-auto"
                            style={{ maxHeight: '320px' }}
                          >
                            {Array.from(groups.entries()).map(
                              ([providerName, providerModels], gi) => {
                                const isCollapsed =
                                  collapsedProviders.has(providerName);
                                const hasActive = providerModels.some(
                                  (m) =>
                                    m.id === selectedModelId &&
                                    m.providerId === selectedProviderId
                                );
                                return (
                                  <div key={providerName}>
                                    <button
                                      onClick={() =>
                                        setCollapsedProviders((prev) => {
                                          const next = new Set(prev);
                                          next.has(providerName)
                                            ? next.delete(providerName)
                                            : next.add(providerName);
                                          return next;
                                        })
                                      }
                                      className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 transition-colors duration-100 ${gi > 0 ? 'border-t border-border' : ''}`}
                                    >
                                      <span
                                        className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                          PROVIDER_COLORS[
                                            providerName.toLowerCase()
                                          ] ?? 'text-muted bg-surface-2'
                                        }`}
                                      >
                                        {providerName}
                                      </span>
                                      <span className="text-[10px] text-faint flex-1 text-left">
                                        {providerModels.length} model
                                        {providerModels.length !== 1 ? 's' : ''}
                                      </span>
                                      {hasActive && !isCollapsed && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                                      )}
                                      {isCollapsed ? (
                                        <CaretDownIcon
                                          size={10}
                                          weight="bold"
                                          className="text-faint flex-shrink-0"
                                        />
                                      ) : (
                                        <CaretUpIcon
                                          size={10}
                                          weight="bold"
                                          className="text-faint flex-shrink-0"
                                        />
                                      )}
                                    </button>
                                    {!isCollapsed &&
                                      providerModels.map((m) => {
                                        const isActive =
                                          m.id === selectedModelId &&
                                          m.providerId === selectedProviderId;
                                        return (
                                          <button
                                            key={`${m.providerId}:${m.id}`}
                                            onClick={() =>
                                              handleModelChange(
                                                m.id,
                                                m.providerId
                                              )
                                            }
                                            className={`w-full text-left px-3 py-2.5 transition-colors duration-100 flex items-center justify-between gap-3 ${
                                              isActive
                                                ? 'bg-accent-muted'
                                                : 'hover:bg-surface-2'
                                            }`}
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <span
                                                className={`text-xs truncate ${isActive ? 'text-accent font-medium' : 'text-text'}`}
                                              >
                                                {m.name}
                                              </span>
                                              {FREE_TIER_PROVIDERS.has(
                                                m.provider.toLowerCase()
                                              ) && (
                                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 flex-shrink-0">
                                                  free
                                                </span>
                                              )}
                                            </div>
                                            {isActive && (
                                              <CheckIcon
                                                size={12}
                                                weight="bold"
                                                className="text-accent flex-shrink-0"
                                              />
                                            )}
                                          </button>
                                        );
                                      })}
                                  </div>
                                );
                              }
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
                <button
                  ref={pickerTriggerRef}
                  onClick={() => setShowModelPicker((v) => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs text-muted hover:text-text hover:bg-surface-2 transition-colors duration-150"
                  title="Select AI model"
                >
                  <BrainIcon size={13} className="text-accent flex-shrink-0" />
                  <span className="hidden sm:inline max-w-[100px] truncate text-text">
                    {activeModel?.name ?? '…'}
                  </span>
                  {activeModel && (
                    <span
                      className={`hidden sm:inline text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider ${PROVIDER_COLORS[activeModel.provider.toLowerCase()] ?? 'text-muted bg-surface-2'}`}
                    >
                      {activeModel.provider}
                    </span>
                  )}
                  {showModelPicker ? (
                    <CaretUpIcon
                      size={9}
                      weight="bold"
                      className="hidden sm:inline flex-shrink-0 text-faint"
                    />
                  ) : (
                    <CaretDownIcon
                      size={9}
                      weight="bold"
                      className="hidden sm:inline flex-shrink-0 text-faint"
                    />
                  )}
                </button>
              </div>

              {/* Clear */}
              {messages.length > 0 && (
                <button
                  onClick={handleClearChat}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs text-muted hover:text-text hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
                  title="Clear chat"
                >
                  <EraserIcon size={13} />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              )}
            </div>

            {/* Send */}
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-accent text-accent-text disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 active:scale-95 transition-all duration-150 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Send (Enter)"
            >
              {loading ? (
                <SpinnerIcon size={14} className="animate-spin" />
              ) : (
                <PaperPlaneTiltIcon size={14} weight="fill" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full resume rewrite card
// ---------------------------------------------------------------------------

function FullResumeCard({
  content,
  onApply,
}: {
  content: string;
  onApply: () => void;
}) {
  const [applied, setApplied] = useState(false);
  const preview = content.split('\n').slice(0, 6).join('\n');

  const handleApply = () => {
    onApply();
    setApplied(true);
  };

  return (
    <div className="w-full max-w-[95%] rounded-xl border border-border bg-surface overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <span className="text-accent select-none" aria-hidden>
          ✦
        </span>
        <span className="font-medium text-text">Full resume rewrite</span>
      </div>
      <div className="px-3 py-2 bg-accent-muted">
        <pre className="whitespace-pre-wrap font-mono text-[11px] text-text leading-relaxed line-clamp-6">
          {preview}
          {content.split('\n').length > 6 && '\n…'}
        </pre>
      </div>
      {applied ? (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border text-accent">
          <CheckIcon size={11} weight="bold" />
          <span>Applied to resume</span>
        </div>
      ) : (
        <div className="flex justify-end gap-2 px-3 py-2 border-t border-border">
          <button
            onClick={handleApply}
            className="flex items-center gap-1 px-2.5 py-1 bg-accent text-accent-text rounded-md hover:opacity-90 transition-opacity duration-150"
          >
            <CheckIcon size={11} weight="bold" />
            Replace resume
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function ThinkingDots() {
  return (
    <span className="inline-flex gap-1 items-center h-4">
      <span
        className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
    </span>
  );
}
