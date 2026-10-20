import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/** Resize existing Leaflet instances without replacing tiles or losing user pan. */
export default function MapViewport({ viewKey, points = [] }) {
  const map = useMap();
  const fitted = useRef(null);
  useEffect(() => {
    let frame;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(map.getContainer());
    window.addEventListener('orientationchange', resize);
    resize();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('orientationchange', resize); };
  }, [map]);
  useEffect(() => {
    const valid = points.filter(p => p.every(Number.isFinite));
    if (!valid.length || viewKey == null || fitted.current === viewKey) return;
    fitted.current = viewKey;
    map.fitBounds(valid, { padding: [32, 32], maxZoom: 15, animate: false });
  }, [map, points, viewKey]);
  return null;
}
