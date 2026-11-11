// "Ask coach about this chart": hand a screenshot (plus the day's trade data) to the Trading Coach page.
import { navigate } from '../store/store';

let pending = null;
/** The Coach page picks this up once when it opens. */
export const takePendingAsk = () => { const p = pending; pending = null; return p; };

/** Any image src (data:, blob:, /api/data/images/…) → a JPEG/PNG data URL no larger than 1800px on its long side. */
export async function imageToDataUrl(src, max = 1800) {
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && blob.size < 3.5e6 && /^image\/(png|jpeg|webp)$/.test(blob.type)) {
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Open the Trading Coach with this image attached and a question ready to edit. focus = detailed data for follow-ups. */
export async function askCoachAboutImage({ src, text, focus = null, title = null }) {
  const image = await imageToDataUrl(src);
  pending = { image, text, focus, title, at: Date.now() };
  navigate('coach?ask=1');
}
