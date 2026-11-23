export default function NextyLogo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const iconSize = size === 'lg' ? 44 : 34;
  const textSize = size === 'lg' ? 'text-2xl' : 'text-lg';

  return (
    <div className="flex items-center gap-3 select-none">
      <div
        className={`rounded-xl border border-red-500/35 bg-[#150a0d] flex items-center justify-center shadow-[0_0_18px_rgba(255,74,99,0.28)] ${
          size === 'lg' ? 'p-2' : 'p-1.5'
        }`}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 64 64"
          role="img"
          aria-label="Nexty Hub"
        >
          <path
            d="M14 50V14L50 50V14"
            fill="none"
            stroke="#ff4a63"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g fill="#150a0d" stroke="#ff4a63" strokeWidth="4">
            <circle cx="14" cy="50" r="6" />
            <circle cx="14" cy="14" r="6" />
            <circle cx="50" cy="50" r="6" />
            <circle cx="50" cy="14" r="6" />
          </g>
          <circle cx="32" cy="32" r="10.5" fill="#ff9a1f" fillOpacity="0.28" />
          <circle cx="32" cy="32" r="7" fill="#ff9a1f" />
        </svg>
      </div>

      <div>
        <div
          className={`font-bold tracking-tight leading-none ${textSize}`}
          style={{ fontFamily: 'var(--font-outfit), var(--font-geist-sans), sans-serif' }}
        >
          <span className="text-[#f6eef0]">Nexty</span>
          <span className="font-normal text-[#ff8596] ml-1.5">Hub</span>
        </div>
        <p className="text-[11px] text-red-300/65 mt-0.5 hidden sm:block">
          Anime Adventures Command Center
        </p>
      </div>
    </div>
  );
}
