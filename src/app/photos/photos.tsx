"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "@/lib/strings";
import { browserClient } from "@/lib/supabase/browser";
import { compressImage } from "@/lib/image";
import { photoUrl } from "@/lib/photos";
import { uuid } from "@/lib/ids";
import { act } from "@/lib/action";
import { Card, Input, Notice, btn } from "@/components/ui";
import { ErrorNote } from "@/components/error-note";
import { Icon } from "@/components/icons";

export type Photo = { id: string; path: string; caption: string | null };

async function upload(path: string, blob: Blob) {
  const { error } = await browserClient().storage.from("portfolio").upload(path, blob, {
    contentType: blob.type, cacheControl: "31536000", upsert: false,
  });
  if (error) throw new Error("upload_failed");
}

export function Photos({ userId, name, avatarPath, initial }: { userId: string; name: string; avatarPath: string | null; initial: Photo[] }) {
  const [photos, setPhotos] = useState(initial);
  const [avatar, setAvatar] = useState(avatarPath);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const cutsInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function changeAvatar(file: File) {
    setBusy("avatar");
    setError(null);
    try {
      const blob = await compressImage(file, 512);
      const path = `${userId}/avatar-${Date.now()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
      await upload(path, blob);
      const r = await act<{ old_path: string | null }>("set_my_photo", { p_path: path });
      if (r.old_path) await browserClient().storage.from("portfolio").remove([r.old_path]);
      setAvatar(path);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addCuts(files: FileList) {
    setBusy("cuts");
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 12 - photos.length)) {
        const blob = await compressImage(file, 1080);
        const path = `${userId}/${uuid()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
        await upload(path, blob);
        const r = await act<{ id: string }>("add_portfolio_photo", { p_path: path, p_caption: caption || null });
        setPhotos((p) => [{ id: r.id, path, caption: caption || null }, ...p]);
      }
      setCaption("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Photo) {
    setBusy(p.id);
    try {
      const r = await act<{ path: string }>("remove_portfolio_photo", { p_photo: p.id });
      await browserClient().storage.from("portfolio").remove([r.path]);
      setPhotos((list) => list.filter((x) => x.id !== p.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const avatarSrc = photoUrl(avatar);
  return (
    <div className="space-y-5">
      <ErrorNote code={error} />
      <Card className="flex items-center gap-4">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-full border-2 border-brand bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatarSrc ? <img src={avatarSrc} alt={name} className="size-full object-cover" /> :
            <div className="flex size-full items-center justify-center text-muted"><Icon name="user" size={36} /></div>}
        </div>
        <div className="flex-1">
          <div className="text-sm text-muted">{s.photos.profile}</div>
          <div className="mb-2 font-display text-xl font-bold">{name}</div>
          <button className={btn("secondary", "w-full")} disabled={!!busy} onClick={() => avatarInput.current?.click()}>
            {busy === "avatar" ? s.photos.uploading : s.photos.changePhoto}
          </button>
          <input ref={avatarInput} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) changeAvatar(f); e.target.value = ""; }} />
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold">{s.photos.title}</h2>
            <p className="text-sm text-muted">{s.photos.count(photos.length)}</p>
          </div>
        </div>
        <Notice>{s.photos.hint}</Notice>
        {photos.length < 12 ? (
          <Card className="space-y-3">
            <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={60} placeholder={s.photos.styleName} />
            <button className={btn("primary", "w-full min-h-14 text-lg")} disabled={!!busy} onClick={() => cutsInput.current?.click()}>
              <Icon name="plus" /> {busy === "cuts" ? s.photos.uploading : s.photos.addCuts}
            </button>
            <input ref={cutsInput} type="file" accept="image/*" multiple hidden
              onChange={(e) => { if (e.target.files?.length) addCuts(e.target.files); e.target.value = ""; }} />
          </Card>
        ) : null}
        {photos.length === 0 ? <p className="rounded-3xl border border-dashed border-line py-10 text-center text-muted">{s.photos.empty}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          {photos.map((p) => (
            <figure key={p.id} className="group relative overflow-hidden rounded-3xl border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(p.path)!} alt={p.caption ?? ""} loading="lazy" className="aspect-[4/5] w-full object-cover" />
              <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent p-3">
                <span className="text-sm font-semibold">{p.caption ?? ""}</span>
                <button onClick={() => remove(p)} disabled={busy === p.id}
                  className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-red-300">{s.photos.remove}</button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
