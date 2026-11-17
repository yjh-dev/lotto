/**
 * 용지 QR 스캐너 — 카메라 미리보기에서 QR을 찾아 문자열을 돌려줌
 *  - 인식: 브라우저 내장 BarcodeDetector가 있으면 사용, 없으면 jsQR
 *  - 카메라를 못 쓰면(권한 거부·HTTPS 아님) "사진으로" 버튼: 사진을 찍거나 골라서 인식
 * 카메라는 HTTPS(Tailscale 주소)·localhost·APK에서만 열린다.
 */
import jsQR from 'jsqr';

interface Detector {
  detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

async function nativeDetector(): Promise<Detector | null> {
  const BD = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    return (await BD.getSupportedFormats()).includes('qr_code') ? new BD({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/** 캔버스에 그린 이미지에서 QR 찾기 */
async function decode(canvas: HTMLCanvasElement, det: Detector | null): Promise<string | null> {
  if (det) {
    try {
      const r = await det.detect(canvas);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch {
      /* jsQR로 */
    }
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** 큰 이미지는 줄여서 그림 (인식 속도) */
function draw(canvas: HTMLCanvasElement, src: CanvasImageSource, w: number, h: number, max = 1280) {
  const k = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0, canvas.width, canvas.height);
}

/** 스캐너를 열고 QR 문자열을 돌려줌. 닫으면 null */
export function scanQr(): Promise<string | null> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'scanner';
    el.innerHTML = `
      <div class="scanner-view"><video playsinline muted></video><div class="scanner-frame"></div></div>
      <p class="scanner-msg">용지 QR을 네모 안에 맞춰 주세요</p>
      <div class="scanner-actions">
        <label class="btn">사진으로<input type="file" accept="image/*" capture="environment" hidden></label>
        <button class="btn" data-close>닫기</button>
      </div>`;
    document.body.append(el);
    const video = el.querySelector('video')!;
    const msg = el.querySelector<HTMLElement>('.scanner-msg')!;
    const canvas = document.createElement('canvas');
    let stream: MediaStream | null = null;
    let done = false;

    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      stream?.getTracks().forEach((t) => t.stop());
      el.remove();
      resolve(v);
    };
    el.querySelector('[data-close]')!.addEventListener('click', () => finish(null));

    void nativeDetector().then(async (det) => {
      // 사진으로
      el.querySelector<HTMLInputElement>('input[type=file]')!.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        msg.textContent = '인식 중…';
        try {
          const bmp = await createImageBitmap(file);
          draw(canvas, bmp, bmp.width, bmp.height, 1600);
          const v = await decode(canvas, det);
          if (v) finish(v);
          else msg.textContent = 'QR을 찾지 못했습니다. QR이 크게 나오게 다시 찍어 주세요';
        } catch {
          msg.textContent = '사진을 읽을 수 없습니다';
        }
      });

      // 실시간 카메라
      if (!navigator.mediaDevices?.getUserMedia) {
        msg.textContent = '이 화면에서는 카메라를 열 수 없습니다 (HTTPS 필요) — "사진으로"를 눌러 주세요';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      } catch {
        msg.textContent = '카메라 권한이 없습니다 — "사진으로"를 눌러 주세요';
        return;
      }
      if (done) return void stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});
      const tick = async () => {
        if (done) return;
        if (video.readyState >= 2 && video.videoWidth) {
          draw(canvas, video, video.videoWidth, video.videoHeight, 960);
          const v = await decode(canvas, det);
          if (v) return finish(v);
        }
        setTimeout(tick, 150);
      };
      void tick();
    });
  });
}
