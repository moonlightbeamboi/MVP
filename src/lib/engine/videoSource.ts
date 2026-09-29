/**
 * Manages the "bus camera" — webcam, bundled sample video, user file, or
 * screen share — on a single <video> element owned by the UI.
 */
export type SourceKind = 'none' | 'webcam' | 'sample' | 'file' | 'screen'

export const SAMPLES: { id: string; label: string; path: string }[] = [
  { id: 'india-city', label: 'Bengaluru street', path: '/samples/bengaluru.mp4' },
  { id: 'mumbai', label: 'Mumbai traffic', path: '/samples/mumbai.mp4' },
  { id: 'potholes', label: 'Bad road — potholes', path: '/samples/potholes.mp4' },
  { id: 'bull', label: 'Cattle on road', path: '/samples/bull.mp4' },
]

export class VideoSourceManager {
  private stream: MediaStream | null = null
  private objectUrl: string | null = null
  /** called when a screen-share track ends (user pressed "Stop sharing") */
  onEnded: (() => void) | null = null

  constructor(private video: HTMLVideoElement) {
    this.video.playsInline = true
    this.video.muted = true
    this.video.loop = false
    this.video.autoplay = true
    this.video.setAttribute('crossorigin', 'anonymous')
    // guard against the play()/load() race: whenever new media becomes playable
    // and we're somehow still paused, kick it again
    this.video.addEventListener('canplay', () => {
      if (this.video.paused) void this.video.play().catch(() => {})
    })
  }

  private stopCurrent() {
    this.onEnded = null
    this.video.pause()
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    this.video.srcObject = null
    this.video.removeAttribute('src')
    this.video.load()
  }

  private async play() {
    try {
      await this.video.play()
    } catch (e) {
      console.warn('video play() interrupted:', e)
    }
  }

  private watchEnded(stream: MediaStream) {
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stopCurrent()
      this.onEnded?.()
    })
  }

  async useWebcam(): Promise<void> {
    this.stopCurrent()
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    this.watchEnded(this.stream)
    this.video.srcObject = this.stream
    await this.play()
  }

  async useSample(path = '/samples/road.mp4'): Promise<void> {
    this.stopCurrent()
    this.video.loop = true
    this.video.src = path
    await this.play()
  }

  async useFile(file: File): Promise<void> {
    this.stopCurrent()
    this.video.loop = true
    this.objectUrl = URL.createObjectURL(file)
    this.video.src = this.objectUrl
    await this.play()
  }

  async useScreen(): Promise<void> {
    this.stopCurrent()
    this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    this.watchEnded(this.stream)
    this.video.srcObject = this.stream
    await this.play()
  }

  stop() {
    this.stopCurrent()
  }
}
