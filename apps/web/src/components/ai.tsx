"use client";

import { Fragment, useState, type ReactNode } from "react";

import { Drawer, useToast } from "@/components/overlay";
import { Alert, Button, ErrorText, Field, Segmented, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import type { AiProvider, AiSettings } from "@/lib/types";

const KEY_LINK: Record<AiProvider, { href: string; label: string }> = {
  gemini: { href: "https://aistudio.google.com/apikey", label: "aistudio.google.com/apikey" },
  openrouter: { href: "https://openrouter.ai/keys", label: "openrouter.ai/keys" },
};

export function AiSettingsDrawer({
  settings,
  onClose,
  onSaved,
}: {
  settings: AiSettings;
  onClose: () => void;
  onSaved: (s: AiSettings) => void;
}) {
  const toast = useToast();
  const defaultModel = (p: AiProvider) => settings.providers.find((x) => x.id === p)?.default_model ?? "";
  const [provider, setProvider] = useState<AiProvider>(settings.provider);
  const [model, setModel] = useState(settings.model === defaultModel(settings.provider) ? "" : settings.model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providerChanged = provider !== settings.provider;
  // Key milik penyedia lain tidak berlaku, jadi wajib diisi ulang saat ganti penyedia.
  const keyRequired = !settings.has_key || providerChanged;

  async function save(clearKey = false): Promise<AiSettings | null> {
    if (!clearKey && keyRequired && !apiKey.trim()) {
      setError(`Isi API key ${providerChanged ? "untuk penyedia baru" : ""}`.trim());
      return null;
    }
    const s = await api<AiSettings>("/settings/ai", {
      method: "PUT",
      body: {
        provider,
        model: model.trim() || null,
        api_key: apiKey.trim() || null,
        clear_key: clearKey,
      },
    });
    onSaved(s);
    setApiKey("");
    return s;
  }

  async function run(kind: "save" | "test" | "clear") {
    setBusy(kind);
    setError(null);
    try {
      const s = await save(kind === "clear");
      if (!s) return;
      if (kind === "test") {
        const res = await api<{ model: string; reply: string }>("/settings/ai/test", { method: "POST" });
        toast(`Terhubung ke ${res.model}`);
      } else {
        toast(kind === "clear" ? "API key dihapus" : "Pengaturan AI disimpan");
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  }

  const link = KEY_LINK[provider];

  return (
    <Drawer
      open
      onClose={onClose}
      title="Pengaturan AI"
      description="Dipakai di halaman Analisis AI."
      footer={
        <>
          {settings.has_key && (
            <Button variant="ghost" className="mr-auto text-danger-700" loading={busy === "clear"} disabled={!!busy} onClick={() => run("clear")}>
              Hapus key
            </Button>
          )}
          <Button variant="secondary" loading={busy === "test"} disabled={!!busy} onClick={() => run("test")}>
            Simpan & uji
          </Button>
          <Button loading={busy === "save"} disabled={!!busy} onClick={() => run("save")}>
            Simpan
          </Button>
        </>
      }
    >
      <form
        className="space-y-5 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          run("save");
        }}
      >
        <div>
          <span className="label-caps mb-1.5 block">Penyedia</span>
          <Segmented<AiProvider>
            label="Penyedia AI"
            value={provider}
            onChange={setProvider}
            options={settings.providers.map((p) => ({ value: p.id, label: p.label }))}
          />
        </div>

        <Field
          label="API key"
          hint={
            <>
              Buat di{" "}
              <a className="font-medium text-brand-700 underline" href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
              . Disimpan terenkripsi di server dan tidak pernah ditampilkan lagi.
            </>
          }
        >
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              settings.has_key && !providerChanged
                ? `Tersimpan (${settings.key_hint}). Kosongkan bila tidak diganti`
                : "Tempel API key di sini"
            }
          />
        </Field>

        <Field label="Model" hint={`Kosongkan untuk memakai ${defaultModel(provider)}.`}>
          <input
            className={inputClass}
            value={model}
            spellCheck={false}
            onChange={(e) => setModel(e.target.value)}
            placeholder={defaultModel(provider)}
          />
        </Field>

        <Alert>
          Yang dikirim ke AI hanya angka ringkasan laporan (pendapatan, jumlah pesanan, layanan, nama kasir,
          ketepatan waktu). Nama dan nomor WA pelanggan tidak ikut dikirim.
        </Alert>

        <ErrorText message={error} />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

// Markdown sederhana dari AI: judul, daftar, paragraf, dan **tebal**. Dirender sebagai elemen React, bukan HTML mentah.
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <h3 key={blocks.length} className="pt-1 text-sm font-semibold text-ink first:pt-0">
          {inline(heading[1].replace(/\*\*/g, ""))}
        </h3>,
      );
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="space-y-3 text-sm leading-relaxed text-ink-2 text-pretty">{blocks}</div>;
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
