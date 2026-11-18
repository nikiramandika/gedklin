"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AiSettingsDrawer, Markdown } from "@/components/ai";
import { AppShell } from "@/components/AppShell";
import { IconArrowLeft, IconHistory, IconKey, IconSparkles, IconTrash } from "@/components/icons";
import { ConfirmDialog, useToast } from "@/components/overlay";
import { PRESETS, PeriodPicker, periodLabel, usePeriod, type Preset } from "@/components/PeriodPicker";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorText,
  IconButton,
  Loading,
  PageHeader,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AiAnalysis, AiSettings, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];

const SUGGESTIONS = [
  "Kenapa pendapatan naik atau turun dibanding periode sebelumnya?",
  "Hari dan jam apa paling ramai? Perlu tambah petugas kapan?",
  "Bagaimana ketepatan waktu, dan apa penyebab yang mungkin?",
];

export default function AnalisisPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api<AiSettings>("/settings/ai")
      .then(setSettings)
      .catch((e: Error) => setSettingsError(e.message));
  }, []);

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Analisis AI"
        description="Ringkasan dan saran dari data laporan. Yang dikirim ke AI hanya angka ringkasan, tanpa data pelanggan."
        actions={
          <>
            <Link href="/dasbor/laporan" className={buttonClass("secondary")}>
              <IconArrowLeft size={18} />
              Laporan
            </Link>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={!settings}>
              <IconKey size={18} />
              Pengaturan AI
            </Button>
          </>
        }
      />

      {/* useSearchParams perlu Suspense agar halaman tetap bisa di-prerender. */}
      <Suspense
        fallback={
          <Card>
            <Loading rows={4} />
          </Card>
        }
      >
        <AnalysisContent settings={settings} settingsError={settingsError} onConfigure={() => setEditing(true)} />
      </Suspense>

      {/* Dipasang hanya saat dibuka supaya form selalu mulai dari pengaturan tersimpan. */}
      {settings && editing && (
        <AiSettingsDrawer settings={settings} onClose={() => setEditing(false)} onSaved={setSettings} />
      )}
    </AppShell>
  );
}

function initialPeriod(params: URLSearchParams): { preset?: Preset; custom?: [string, string] } {
  const preset = params.get("periode") as Preset | null;
  const start = params.get("start");
  const end = params.get("end");
  if (preset === "custom" && start && end) return { preset, custom: [start, end] };
  if (preset && PRESETS.includes(preset) && preset !== "custom") return { preset };
  return {};
}

function AnalysisContent({
  settings,
  settingsError,
  onConfigure,
}: {
  settings: AiSettings | null;
  settingsError: string | null;
  onConfigure: () => void;
}) {
  const toast = useToast();
  const params = useSearchParams();
  const period = usePeriod(initialPeriod(params));
  const { range } = period;

  const [history, setHistory] = useState<AiAnalysis[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AiAnalysis | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<AiAnalysis[]>("/reports/ai-analyses")
        .then(setHistory)
        .catch((e: Error) => setHistoryError(e.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Tanpa pilihan, tampilkan analisis umum terbaru untuk periode ini bila sudah pernah dibuat.
  const saved =
    range && history?.find((h) => h.period_start === range[0] && h.period_end === range[1] && !h.question);
  const shown = (selectedId !== null ? history?.find((h) => h.id === selectedId) : saved) ?? null;

  async function analyze(q: string) {
    if (!range) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<AiAnalysis>("/reports/ai-analysis", {
        method: "POST",
        body: { start: range[0], end: range[1], question: q.trim() || null },
      });
      setHistory((h) => [res, ...(h ?? [])]);
      setSelectedId(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analisis gagal");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(`/reports/ai-analyses/${deleting.id}`, { method: "DELETE" });
      setHistory((h) => h && h.filter((x) => x.id !== deleting.id));
      if (selectedId === deleting.id) setSelectedId(null);
      setDeleting(null);
      toast("Analisis dihapus");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <PeriodPicker period={period} label="Periode analisis" />

        <Card title="Analisis baru" description="Kosongkan pertanyaan untuk analisis umum: ringkasan, temuan, dan saran.">
          {!settings ? (
            settingsError ? <ErrorText message={settingsError} /> : <Loading rows={1} />
          ) : !settings.has_key ? (
            <Alert
              action={
                <Button size="sm" onClick={onConfigure}>
                  Atur sekarang
                </Button>
              }
            >
              Isi API key Gemini atau OpenRouter dulu di Pengaturan AI.
            </Alert>
          ) : (
            <div className="space-y-3">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  analyze(question);
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Pertanyaan untuk AI (opsional)</span>
                  <input
                    className={inputClass}
                    value={question}
                    maxLength={500}
                    placeholder="Tanya sesuatu tentang periode ini (opsional)"
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </label>
                <Button type="submit" loading={busy} disabled={!range}>
                  <IconSparkles size={18} />
                  {busy ? "Menganalisis…" : question.trim() ? "Tanya AI" : "Analisis"}
                </Button>
              </form>
              <ul className="flex flex-wrap gap-2" aria-label="Contoh pertanyaan">
                {SUGGESTIONS.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={busy || !range}
                      onClick={() => {
                        setQuestion(s);
                        analyze(s);
                      }}
                      className="rounded-full bg-canvas px-3 py-1.5 text-left text-xs text-ink-2 ring-1 ring-inset ring-line transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:text-faint"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                {settings.providers.find((p) => p.id === settings.provider)?.label} · {settings.model}
              </p>
              <ErrorText message={error} />
            </div>
          )}
        </Card>

        {busy ? (
          <Card title="Menganalisis…">
            <Loading rows={4} text="AI sedang membaca laporan…" />
          </Card>
        ) : shown ? (
          <ResultCard analysis={shown} />
        ) : (
          <div className="rounded-2xl bg-surface shadow-card">
            <EmptyState icon={IconSparkles} title="Belum ada analisis untuk periode ini">
              Pilih periode, lalu klik Analisis. Hasilnya tersimpan di riwayat.
            </EmptyState>
          </div>
        )}
      </div>

      <Card title="Riwayat" description="Analisis tersimpan, bisa dibuka lagi tanpa memanggil AI." flush>
        {!history ? (
          historyError ? (
            <div className="px-4 pb-4 sm:px-5">
              <ErrorText message={historyError} />
            </div>
          ) : (
            <Loading rows={3} />
          )
        ) : history.length === 0 ? (
          <EmptyState icon={IconHistory} title="Belum ada riwayat" />
        ) : (
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto px-2 pb-3 sm:px-3">
            {history.map((h) => {
              const active = shown?.id === h.id;
              return (
                <li key={h.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(h.id)}
                    aria-current={active || undefined}
                    className={`block w-full rounded-xl py-2.5 pl-3 pr-11 text-left transition-colors ${
                      active ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-subtle"
                    }`}
                  >
                    <span className="line-clamp-2 text-sm font-medium text-ink">{h.question ?? "Analisis umum"}</span>
                    <span className="mt-0.5 block text-xs text-ink-2">{periodLabel(h.period_start, h.period_end)}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {formatDateTime(h.created_at)}
                      {h.created_by_name ? ` · ${h.created_by_name}` : ""}
                    </span>
                  </button>
                  <IconButton
                    label="Hapus analisis"
                    icon={IconTrash}
                    size={16}
                    className="absolute right-1 top-1.5"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(h);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Hapus analisis?"
        confirmLabel="Hapus"
        busy={deleteBusy}
        error={deleteError}
      >
        {deleting && (
          <>
            {deleting.question ?? "Analisis umum"} ({periodLabel(deleting.period_start, deleting.period_end)}) akan
            dihapus dari riwayat.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function ResultCard({ analysis: a }: { analysis: AiAnalysis }) {
  return (
    <Card
      title={a.question ?? "Analisis umum"}
      description={`${periodLabel(a.period_start, a.period_end)} · dibuat ${formatDateTime(a.created_at)}`}
    >
      <Markdown text={a.text} />
      <p className="mt-5 border-t border-line pt-3 text-xs text-muted">
        {a.model}
        {a.created_by_name ? ` · oleh ${a.created_by_name}` : ""}. AI bisa keliru; cocokkan dengan angka di halaman
        Laporan.
      </p>
    </Card>
  );
}
