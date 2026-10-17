import { useEffect, useRef, useState } from 'react'
import { normalizeBarcode } from '../../domain/barcode/barcode'

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector

/**
 * Lecture d'un code par la caméra, OPTIONNELLE : uniquement si le navigateur fournit l'API BarcodeDetector
 * (Chrome et Edge sur Android ; pas Safari iOS ni Firefox à ce jour) et en HTTPS. Non testé en exécution sur
 * un appareil réel. La douchette USB (clavier + Entrée) reste la méthode fiable.
 */
export default function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
    if (!Ctor) { setError('Lecture par caméra non prise en charge par ce navigateur.'); return }
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128'] })

    async function loop() {
      if (stopped || !video.current) return
      try {
        const codes = await detector.detect(video.current)
        const code = codes[0]?.rawValue ? normalizeBarcode(codes[0].rawValue) : ''
        if (code) { onCode(code); return }
      } catch {
        // image pas encore prête : on réessaie
      }
      timer = setTimeout(loop, 250)
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((media) => {
        stream = media
        if (!video.current || stopped) return
        video.current.srcObject = media
        return video.current.play().then(loop)
      })
      .catch(() => setError('Caméra indisponible ou accès refusé.'))

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onCode])

  return (
    <div className="bq-card bq-stack" role="dialog" aria-label="Lecture par caméra">
      {error ? <p className="bq-error" role="alert">{error}</p> : <video ref={video} className="bq-camera" muted playsInline />}
      <button className="secondary-button" onClick={onClose}>Fermer la caméra</button>
    </div>
  )
}
