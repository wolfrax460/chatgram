/** Small shared pieces for the Status page. */

export function Avatar({
  name,
  src,
  size = 44,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}
