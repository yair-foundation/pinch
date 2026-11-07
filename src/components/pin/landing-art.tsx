/*
 * The landing's drawings (D169): Pinch's own world of screenshots, a pointer, a talker and an agent.
 * Hand-drawn SVG in the landing's colours, styled by `.o` and `.t` in `landing.css`.
 */

type ArtProps = { className?: string };

/** The marks on each sample screen, in its 320 by 300 drawing. */
export const MOCK_SPOTS = [
  [
    { n: 1, x: 14, y: 50, w: 146, h: 74 },
    { n: 2, x: 14, y: 164, w: 120, h: 46 },
    { n: 3, x: 186, y: 62, w: 120, h: 136 },
  ],
  [
    { n: 1, x: 14, y: 54, w: 172, h: 70 },
    { n: 2, x: 202, y: 36, w: 94, h: 94 },
    { n: 3, x: 14, y: 160, w: 126, h: 48 },
  ],
  [
    { n: 1, x: 14, y: 44, w: 116, h: 92 },
    { n: 2, x: 14, y: 150, w: 170, h: 40 },
    { n: 3, x: 186, y: 66, w: 120, h: 112 },
  ],
];

/** The author's cursor (D135): an arrow with no leg, in a drawing 82 by 85, its tip at 8.2, 10.6. */
export const CURSOR_PATH =
  'M32.6389 74.8863L8.18983 10.5709C7.61473 9.05806 9.00696 7.59711 10.4499 8.19924L71.7928 33.7977C73.1748 34.3746 73.3641 36.3478 72.1123 37.1274L49.7021 51.0827C49.4565 51.2356 49.252 51.4502 49.1065 51.7079L35.814 75.2193C35.0715 76.5328 33.1897 76.3353 32.6389 74.8863Z';

export function PinchScene({ className }: ArtProps) {
  return (
    <svg
      className={className}
      width="340"
      height="560"
      viewBox="0 0 340 560"
      role="img"
      aria-label="A hand pinches tiny screenshots into a box, below a line of pegged-up designs, saying: this one."
    >
      <path className="o" fill="none" d="M0 34H300" />
      <circle cx="304" cy="34" r="8" fill="#17131f" />
      <g transform="rotate(-3 62 90)">
        <g className="sway sway-1">
          <rect className="o" x="22" y="44" width="82" height="100" rx="6" fill="#fff" />
          <rect className="o" x="32" y="55" width="62" height="38" rx="3" fill="#f59bd8" />
          <circle cx="63" cy="74" r="10" fill="#ffc93c" className="t" />
          <path className="t" d="M34 106H90M34 118H72" />
          <rect className="o" x="55" y="26" width="13" height="28" rx="4" fill="#ffc93c" />
        </g>
      </g>
      <g transform="rotate(2 160 90)">
        <g className="sway sway-2">
          <rect className="o" x="120" y="44" width="82" height="100" rx="6" fill="#ffc93c" />
          <path d="M131 80V62h44M131 88h60" className="t" style={{ strokeWidth: 7 }} />
          <rect className="o" x="131" y="108" width="40" height="18" rx="9" fill="#17131f" />
          <rect className="o" x="154" y="26" width="13" height="28" rx="4" fill="#f59bd8" />
        </g>
      </g>
      <g transform="rotate(-2 256 86)">
        <g className="sway sway-3">
          <rect className="o" x="218" y="44" width="76" height="94" rx="6" fill="#3b9f87" />
          <circle className="o" cx="256" cy="80" r="20" fill="#fff" />
          <circle cx="256" cy="80" r="7" fill="#f2613f" />
          <path d="M232 120h48" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <rect className="o" x="250" y="26" width="13" height="28" rx="4" fill="#fff" />
        </g>
      </g>

      <rect className="o" x="-10" y="182" width="104" height="80" fill="#3b9f87" />
      <path
        d="M12 186v74M58 186v74"
        stroke="#17131f"
        strokeWidth="3"
        strokeDasharray="1 9"
        strokeLinecap="round"
      />
      <rect className="o" x="90" y="172" width="44" height="100" rx="14" fill="#fff" />
      <path
        className="o"
        fill="#f59bd8"
        d="M134 186C174 160 240 172 262 236C272 266 276 292 270 314C266 328 250 326 246 314C238 292 222 272 204 262C194 270 214 300 240 324C222 336 190 326 166 300C154 288 144 276 134 268Z"
      />
      <path
        className="t"
        d="M174 196c6 8 8 16 6 26M198 192c8 8 10 18 8 30M204 262c10 2 18 8 26 18"
      />
      <path className="t" d="M292 186l14-18M304 222l22-10M304 258h24" />
      <rect
        className="o"
        style={{ strokeWidth: 3 }}
        x="252"
        y="324"
        width="14"
        height="14"
        rx="2"
        fill="#fff"
        transform="rotate(12 259 331)"
      />
      <g>
        <rect
          className="bit o"
          style={{ strokeWidth: 3 }}
          x="268"
          y="358"
          width="11"
          height="11"
          rx="2"
          fill="#f59bd8"
        />
        <rect
          className="bit o"
          style={{ strokeWidth: 3 }}
          x="232"
          y="374"
          width="11"
          height="11"
          rx="2"
          fill="#fff"
        />
        <rect
          className="bit o"
          style={{ strokeWidth: 3 }}
          x="262"
          y="396"
          width="11"
          height="11"
          rx="2"
          fill="#ffc93c"
        />
        <rect
          className="bit o"
          style={{ strokeWidth: 3 }}
          x="218"
          y="412"
          width="11"
          height="11"
          rx="2"
          fill="#fff"
        />
      </g>

      <path
        className="o"
        fill="#fff"
        d="M30 300H172C184 300 192 308 192 320V348C192 360 184 368 172 368H72L38 396L46 368H30C18 368 10 360 10 348V320C10 308 18 300 30 300Z"
      />
      <text x="101" y="340" textAnchor="middle" fontSize="19">
        THIS ONE.
      </text>

      <path className="o" fill="#fff" d="M74 448L44 420L126 420L150 448Z" />
      <path className="o" fill="#ffc93c" d="M312 448L336 416L256 416L226 448Z" />
      <rect className="o" x="74" y="446" width="238" height="130" rx="8" fill="#f2613f" />
      <rect className="o" x="128" y="474" width="130" height="50" rx="10" fill="#f59bd8" />
      <text x="193" y="495" textAnchor="middle" fontSize="12.5">
        FOR YOUR
      </text>
      <text x="193" y="512" textAnchor="middle" fontSize="12.5">
        AGENT
      </text>
      <path d="M96 470v50M112 470v30" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

export function TalkScene({
  className,
  say = ['THAT BUTTON?', 'MORE OF THAT.'],
  gaze,
}: ArtProps & {
  say?: readonly [string, string];
  /** The cat's eyes and pupils, for `useGaze`: the pupils are drawn looking straight ahead. */
  gaze?: { eyes: React.Ref<SVGGElement>; look: React.Ref<SVGGElement> };
}) {
  return (
    <svg
      className={className}
      width="340"
      height="560"
      viewBox="0 0 340 560"
      role="img"
      aria-label="A curly-haired designer talks into a microphone, saying: that button? More of that. A black cat hunts a computer mouse at their feet."
    >
      <g transform="translate(34 56) scale(.9)">
        <g fill="#ffc93c" className="o">
          <circle cx="206" cy="232" r="32" />
          <circle cx="242" cy="200" r="36" />
          <circle cx="290" cy="198" r="38" />
          <circle cx="328" cy="232" r="32" />
          <circle cx="196" cy="276" r="24" />
          <circle cx="338" cy="280" r="24" />
        </g>
        <g fill="#ffc93c">
          <circle cx="206" cy="232" r="30" />
          <circle cx="242" cy="200" r="34" />
          <circle cx="290" cy="198" r="36" />
          <circle cx="328" cy="232" r="30" />
          <circle cx="196" cy="276" r="22" />
          <circle cx="338" cy="280" r="22" />
          <circle cx="265" cy="240" r="60" />
        </g>

        <path
          className="o"
          fill="#3b9f87"
          d="M150 570C154 480 176 424 238 408H296C340 420 356 480 360 570Z"
        />
        <path className="t" d="M246 410L268 436L288 410" />
        <path className="t" d="M268 436V570" />
        <path className="o" fill="#f59bd8" d="M246 372V404C246 426 288 426 288 404V372Z" />

        <path
          className="o"
          fill="#f59bd8"
          d="M211 268C212 232 238 216 268 216C298 216 322 232 323 268C325 320 303 384 267 384C231 384 209 320 211 268Z"
        />
        <path
          className="o"
          fill="#ffc93c"
          d="M210 276C232 274 262 262 276 236C286 256 304 270 324 274C324 238 302 210 268 210C232 210 208 238 210 276Z"
        />
        <circle cx="246" cy="302" r="7" fill="#17131f" />
        <circle cx="292" cy="302" r="7" fill="#17131f" />
        <path className="t" d="M235 285c6-4 12-5 18-3M285 282c6-2 12-1 18 3" />
        <circle cx="229" cy="326" r="9" fill="#f2613f" opacity=".85" />
        <circle cx="309" cy="326" r="9" fill="#f2613f" opacity=".85" />
        <path
          className="o"
          fill="#17131f"
          style={{ strokeWidth: 3 }}
          d="M254 336C262 342 278 342 286 336C286 354 276 362 270 362C264 362 254 354 254 336Z"
        />

        <path
          d="M176 560C160 520 160 482 176 448"
          fill="none"
          stroke="#17131f"
          strokeWidth="48"
          strokeLinecap="round"
        />
        <path
          d="M176 560C160 520 160 482 176 448"
          fill="none"
          stroke="#3b9f87"
          strokeWidth="40"
          strokeLinecap="round"
        />
        <path d="M180 430L198 366" stroke="#17131f" strokeWidth="16" strokeLinecap="round" />
        <circle className="o" cx="201" cy="352" r="19" fill="#ffc93c" />
        <path className="t" d="M190 345l20 16M197 336l16 14M187 356l14 12" />
        <path
          className="o"
          fill="#f59bd8"
          d="M158 420C166 400 194 404 200 420C206 440 186 458 170 452C158 448 152 434 158 420Z"
        />
        <path className="t" d="M168 424h22M164 436h24" />
      </g>

      <path
        className="o"
        fill="#fff"
        d="M28 136H182C194 136 202 144 202 156V192C202 204 194 212 182 212H168L196 250L128 212H28C16 212 8 204 8 192V156C8 144 16 136 28 136Z"
      />
      <text x="105" y="168" textAnchor="middle" fontSize="17">
        {say[0]}
      </text>
      <text x="105" y="192" textAnchor="middle" fontSize="17">
        {say[1]}
      </text>

      <g transform="translate(-14 0)">
        <path
          fill="#17131f"
          d="M24 570C14 520 20 486 32 462L26 428L52 446C62 442 72 442 82 446L108 428L104 462C118 490 124 530 118 570Z"
        />
        <g ref={gaze?.eyes}>
          <ellipse cx="54" cy="478" rx="9" ry="6" fill="#fff" />
          <ellipse cx="84" cy="478" rx="9" ry="6" fill="#fff" />
        </g>
        <g ref={gaze?.look} className="gaze" style={{ transform: 'translate(5px, 2px)' }}>
          <ellipse cx="54" cy="478" rx="3.500" ry="5" fill="#17131f" />
          <ellipse cx="84" cy="478" rx="3.500" ry="5" fill="#17131f" />
        </g>
        <path d="M65 490h8l-4 5Z" fill="#f59bd8" />
      </g>
      <path className="o" fill="#fff" d="M106 564C100 516 166 510 170 564Z" />
      <path className="o" fill="#f59bd8" style={{ strokeWidth: 3 }} d="M133 528h8v12h-8Z" />
      <path d="M100 536c8-4 18-2 20 8s-10 16-20 12Z" fill="#17131f" />
    </svg>
  );
}

export function StepAdd({ className }: ArtProps) {
  return (
    <svg className={className} width="112" height="104" viewBox="0 0 112 104" aria-hidden="true">
      <g transform="rotate(-9 44 54)">
        <rect className="o" x="10" y="20" width="66" height="72" rx="6" fill="#f59bd8" />
      </g>
      <g transform="rotate(5 56 50)">
        <rect className="o" x="24" y="10" width="66" height="76" rx="6" fill="#fff" />
        <rect
          className="o"
          style={{ strokeWidth: 3 }}
          x="33"
          y="20"
          width="48"
          height="28"
          rx="3"
          fill="#d8c3f6"
        />
        <circle cx="57" cy="34" r="8" fill="#f2613f" className="t" />
        <path className="t" d="M34 60H78M34 72H60" />
      </g>
      <circle className="o" cx="90" cy="78" r="17" fill="#ffc93c" />
      <path className="t" d="M90 70v16M82 78h16" />
    </svg>
  );
}

export function StepSay({ className }: ArtProps) {
  return (
    <svg className={className} width="112" height="104" viewBox="0 0 112 104" aria-hidden="true">
      <path className="t" d="M14 30l8 6M8 54h10M14 78l8-6M98 30l-8 6M104 54H94M98 78l-8-6" />
      <rect className="o" x="38" y="8" width="36" height="58" rx="18" fill="#3b9f87" />
      <path className="t" d="M38 28h14M38 40h14M60 28h14M60 40h14" />
      <path className="o" fill="none" d="M28 48c0 42 56 42 56 0" />
      <path className="o" fill="none" d="M56 80v14" />
      <rect className="o" x="36" y="90" width="40" height="10" rx="5" fill="#f59bd8" />
    </svg>
  );
}

export function StepPoint({ className }: ArtProps) {
  return (
    <svg className={className} width="112" height="104" viewBox="0 0 112 104" aria-hidden="true">
      <rect className="o" x="8" y="10" width="72" height="60" rx="6" fill="#ffc93c" />
      <path className="t" d="M20 26H60M20 38H44" />
      <circle className="o" cx="26" cy="56" r="11" fill="#fff" style={{ strokeWidth: 3 }} />
      <text x="26" y="61" fontSize="13" textAnchor="middle" style={{ letterSpacing: 0 }}>
        1
      </text>
      <path
        className="o"
        fill="#fff"
        transform="translate(44 38) scale(.75)"
        style={{ strokeWidth: 5.3 }}
        d={CURSOR_PATH}
      />
      <path className="t" d="M96 40l8-8M100 54h9" />
    </svg>
  );
}

export function StepHand({ className }: ArtProps) {
  return (
    <svg className={className} width="112" height="104" viewBox="0 0 112 104" aria-hidden="true">
      <path className="o" fill="#fff" d="M22 38L8 22H46L56 38Z" />
      <path className="o" fill="#ffc93c" d="M90 38L104 22H66L56 38Z" />
      <rect className="o" x="22" y="38" width="68" height="58" rx="5" fill="#f2613f" />
      <rect
        className="o"
        style={{ strokeWidth: 3 }}
        x="36"
        y="54"
        width="40"
        height="24"
        rx="5"
        fill="#f59bd8"
      />
      <path className="t" d="M44 62h24M44 70h14" />
      <path className="t" d="M56 14V4M38 12l-4-8M74 12l4-8" />
    </svg>
  );
}

/** The agent, looking through a reel viewer: the reel turns, and the lever goes down, on each turn. */
export function Robot({
  className,
  turns = 0,
  pulling = false,
}: ArtProps & { turns?: number; pulling?: boolean }) {
  return (
    <svg className={className} width="150" height="124" viewBox="0 0 150 124" aria-hidden="true">
      <path className="o" fill="none" d="M75 26V8" />
      <circle className="o" cx="75" cy="8" r="6" fill="#f2613f" style={{ strokeWidth: 3 }} />
      <rect className="o" x="26" y="26" width="98" height="110" rx="20" fill="#ffc93c" />
      <rect className="o" x="12" y="62" width="14" height="30" rx="5" fill="#f59bd8" />
      <rect className="o" x="124" y="62" width="14" height="30" rx="5" fill="#f59bd8" />
      <g className="viewer-reel" style={{ transform: `rotate(${turns * 51.43}deg)` }}>
        <circle className="o" cx="75" cy="50" r="19" fill="#fff" style={{ strokeWidth: 3 }} />
        {[0, 51.43, 102.86, 154.29, 205.71, 257.14, 308.57].map((angle) => (
          <rect
            key={angle}
            x="72"
            y="34"
            width="6"
            height="6"
            rx="1"
            fill="#5a32d1"
            transform={`rotate(${angle} 75 50)`}
          />
        ))}
        <circle cx="75" cy="50" r="3" fill="#17131f" />
      </g>
      <rect className="o" x="30" y="54" width="90" height="44" rx="14" fill="#f2613f" />
      <circle className="o" cx="56" cy="76" r="12" fill="#17131f" style={{ strokeWidth: 3 }} />
      <circle className="o" cx="94" cy="76" r="12" fill="#17131f" style={{ strokeWidth: 3 }} />
      <circle cx="52" cy="72" r="3" fill="#fff" />
      <circle cx="90" cy="72" r="3" fill="#fff" />
      <g className="viewer-lever" data-down={pulling}>
        <path d="M122 68L142 68" stroke="#17131f" strokeWidth="6" strokeLinecap="round" />
        <circle className="o" cx="145" cy="68" r="5" fill="#fff6e0" style={{ strokeWidth: 3 }} />
      </g>
    </svg>
  );
}

export function Bubble({ className }: ArtProps) {
  return (
    <svg className={className} width="270" height="92" viewBox="0 0 270 92" aria-hidden="true">
      <path
        className="o"
        fill="#fff"
        d="M20 4H224C236 4 244 12 244 22V36L266 52L244 56V58C244 68 236 76 224 76H20C10 76 4 68 4 58V22C4 12 10 4 20 4Z"
      />
      <text x="124" y="34" textAnchor="middle" fontSize="16.500">
        FINALLY, SOME
      </text>
      <text x="124" y="57" textAnchor="middle" fontSize="16.500">
        DIRECTION.
      </text>
    </svg>
  );
}

const TITLE_FONT = { fontFamily: "'Bricolage Grotesque',sans-serif", letterSpacing: '-.5px' };

function SundayMarket() {
  return (
    <>
      <rect
        x="1"
        y="1"
        width="318"
        height="298"
        rx="12"
        fill="#fff6e0"
        stroke="#17131f"
        strokeWidth="2"
      />
      <circle cx="26" cy="24" r="6" fill="#3b9f87" />
      <path
        d="M42 24h44M240 24h20M270 24h26"
        stroke="#17131f"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <text
        x="22"
        y="80"
        fontSize="29"
        style={{ fontFamily: "'Bricolage Grotesque',sans-serif", letterSpacing: '-.5px' }}
      >
        Fresh on
      </text>
      <text
        x="22"
        y="111"
        fontSize="29"
        style={{ fontFamily: "'Bricolage Grotesque',sans-serif", letterSpacing: '-.5px' }}
      >
        Sunday.
      </text>
      <path
        d="M22 138H150M22 152H128"
        stroke="#544e60"
        strokeWidth="3.500"
        strokeLinecap="round"
        opacity=".6"
      />
      <rect x="22" y="172" width="104" height="30" rx="8" fill="#3b9f87" />
      <text
        x="74"
        y="192"
        textAnchor="middle"
        fontSize="11"
        style={{ fill: '#fff', letterSpacing: 0 }}
      >
        See the stalls
      </text>
      <path
        className="o"
        fill="#ffc93c"
        d="M204 118C224 88 276 92 288 128C298 162 266 194 232 186C202 180 188 146 204 118Z"
      />
      <path className="o" fill="#3b9f87" d="M252 94C252 78 264 68 280 70C280 84 268 96 252 94Z" />
      <circle cx="228" cy="134" r="4" fill="#17131f" />
      <circle cx="256" cy="130" r="4" fill="#17131f" />
      <path className="t" d="M232 152c8 7 18 6 26-2" />
      <circle cx="216" cy="146" r="6" fill="#f59bd8" />
      <circle cx="270" cy="142" r="6" fill="#f59bd8" />
      <rect
        x="22"
        y="228"
        width="84"
        height="50"
        rx="8"
        fill="#fff"
        stroke="#17131f"
        strokeWidth="2"
      />
      <rect
        x="118"
        y="228"
        width="84"
        height="50"
        rx="8"
        fill="#f59bd8"
        stroke="#17131f"
        strokeWidth="2"
      />
      <rect
        x="214"
        y="228"
        width="84"
        height="50"
        rx="8"
        fill="#d8c3f6"
        stroke="#17131f"
        strokeWidth="2"
      />
    </>
  );
}

function NightTrain() {
  return (
    <>
      <rect
        x="1"
        y="1"
        width="318"
        height="298"
        rx="12"
        fill="#241a4d"
        stroke="#17131f"
        strokeWidth="2"
      />
      <circle cx="26" cy="24" r="6" fill="#ffc93c" />
      <path d="M42 24h44M240 24h20M270 24h26" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <g fill="#fff">
        <circle cx="176" cy="40" r="2" />
        <circle cx="150" cy="130" r="2" />
        <circle cx="286" cy="146" r="2" />
        <circle cx="208" cy="168" r="2" />
        <circle cx="262" cy="196" r="2" />
      </g>
      <text x="22" y="82" fontSize="25" style={{ ...TITLE_FONT, fill: '#fff' }}>
        Sleep your way
      </text>
      <text x="22" y="110" fontSize="25" style={{ ...TITLE_FONT, fill: '#fff' }}>
        to Lisbon.
      </text>
      <path
        d="M22 134H124M22 146H100"
        stroke="#fff"
        strokeWidth="3.500"
        strokeLinecap="round"
        opacity=".45"
      />
      <rect x="22" y="168" width="110" height="32" rx="8" fill="#3d3268" />
      <text
        x="77"
        y="189"
        textAnchor="middle"
        fontSize="11.500"
        style={{ fill: '#cfc6f2', letterSpacing: 0 }}
      >
        Book a bed
      </text>
      <circle className="o" cx="249" cy="83" r="36" fill="#ffc93c" />
      <circle cx="238" cy="74" r="7" fill="#e8ad22" />
      <circle cx="262" cy="96" r="5" fill="#e8ad22" />
      <path className="t" d="M238 92c5 6 12 6 17 0" />
      <rect className="o" x="-6" y="236" width="332" height="40" rx="10" fill="#f2613f" />
      <rect x="22" y="246" width="44" height="18" rx="4" fill="#ffc93c" />
      <rect x="86" y="246" width="44" height="18" rx="4" fill="#fff6e0" />
      <rect x="150" y="246" width="44" height="18" rx="4" fill="#ffc93c" />
      <rect x="214" y="246" width="44" height="18" rx="4" fill="#fff6e0" />
      <path d="M0 288H320" stroke="#fff" strokeWidth="3" strokeDasharray="14 12" opacity=".5" />
    </>
  );
}

function TinyBank() {
  return (
    <>
      <rect
        x="1"
        y="1"
        width="318"
        height="298"
        rx="12"
        fill="#dff3ea"
        stroke="#17131f"
        strokeWidth="2"
      />
      <circle cx="26" cy="24" r="6" fill="#3b9f87" />
      <path
        d="M42 24h44M240 24h20M270 24h26"
        stroke="#17131f"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <text x="22" y="118" fontSize="76" style={TITLE_FONT}>
        $3
      </text>
      <g fontSize="9.500" textAnchor="middle" style={{ letterSpacing: 0 }}>
        <rect x="22" y="158" width="46" height="24" rx="12" fill="#f59bd8" />
        <text x="45" y="174">
          NEW
        </text>
        <rect x="74" y="158" width="46" height="24" rx="12" fill="#ffc93c" />
        <text x="97" y="174">
          HOT
        </text>
        <rect x="126" y="158" width="50" height="24" rx="12" fill="#d8c3f6" />
        <text x="151" y="174">
          WOW
        </text>
      </g>
      <path
        className="o"
        fill="#f59bd8"
        d="M196 124C196 98 222 84 248 84C276 84 298 102 298 126C298 150 276 166 248 166C222 166 196 150 196 124Z"
      />
      <path className="o" fill="#f59bd8" d="M224 92L216 72L240 84Z" />
      <rect x="236" y="92" width="26" height="5" rx="2.500" fill="#17131f" />
      <circle cx="224" cy="118" r="4" fill="#17131f" />
      <ellipse
        className="o"
        cx="204"
        cy="132"
        rx="11"
        ry="9"
        fill="#fff"
        style={{ strokeWidth: 3 }}
      />
      <path className="t" d="M216 174v-10M280 174v-12" />
      <rect
        x="22"
        y="214"
        width="276"
        height="62"
        rx="10"
        fill="#fff"
        stroke="#17131f"
        strokeWidth="2"
      />
      <path
        d="M38 234H170M38 250H128"
        stroke="#544e60"
        strokeWidth="3.500"
        strokeLinecap="round"
        opacity=".6"
      />
      <circle cx="268" cy="245" r="14" fill="#3b9f87" />
    </>
  );
}

const MOCK_ART = [SundayMarket, NightTrain, TinyBank];

/** A sample screen with its marks, which come one at a time. */
export function MarkedPage({
  className,
  screen = 0,
  shown = () => true,
}: ArtProps & { screen?: number; shown?: (i: number) => boolean }) {
  const Art = MOCK_ART[screen];
  return (
    <svg className={className} viewBox="0 0 320 300" aria-hidden="true">
      <Art />
      <g fontSize="14" textAnchor="middle">
        {MOCK_SPOTS[screen].map((spot, i) => (
          <g key={spot.n} className="mock-spot" data-on={shown(i)}>
            <rect
              x={spot.x}
              y={spot.y}
              width={spot.w}
              height={spot.h}
              rx="8"
              fill="none"
              stroke="#5a32d1"
              strokeWidth="3"
              pathLength={1}
            />
            <g className="mock-number">
              <circle
                cx={spot.x + spot.w}
                cy={spot.y}
                r="14"
                fill="#fff"
                stroke="#5a32d1"
                strokeWidth="3"
              />
              <text x={spot.x + spot.w} y={spot.y + 5} style={{ letterSpacing: 0 }}>
                {spot.n}
              </text>
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Beside the questions (D177): one asked, pointed at, and taken well. */
export function Asking({ className }: ArtProps) {
  return (
    <svg className={className} width="300" height="222" viewBox="0 0 300 222" aria-hidden="true">
      <path
        className="o"
        fill="#ffc93c"
        d="M32 8H144C157 8 168 19 168 32V94C168 107 157 118 144 118H64L40 140L44 118H32C19 118 8 107 8 94V32C8 19 19 8 32 8Z"
      />
      <path
        className="t"
        style={{ strokeWidth: 8 }}
        d="M70 46C70 24 106 24 106 46C106 60 88 60 88 76"
      />
      <circle cx="88" cy="96" r="6" fill="#17131f" />
      <path
        className="o"
        fill="#fff"
        transform="translate(154 28) scale(.75)"
        style={{ strokeWidth: 5.3 }}
        d={CURSOR_PATH}
      />
      <path className="t" d="M222 32l8-8M226 48h9" />
      <path
        className="o"
        fill="#fff"
        d="M148 124H268C281 124 292 135 292 148V176C292 189 281 200 268 200H256L266 216L236 200H148C135 200 124 189 124 176V148C124 135 135 124 148 124Z"
      />
      <text x="208" y="168" textAnchor="middle" fontSize="18">
        GOOD ONE.
      </text>
    </svg>
  );
}

/** A phone's excuse (D170): a poster for the missing mouse, a sorry phone, and the cat that checked. */
export function MissingMouse({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 320"
      role="img"
      aria-label="A missing poster for a computer mouse. A black cat says: I checked. No mouse. A small phone says: sorry."
    >
      <path className="o" fill="none" d="M0 30H320" />
      <g transform="rotate(-3 112 96)">
        <rect className="o" x="46" y="40" width="132" height="124" rx="6" fill="#fff" />
        <text x="112" y="66" textAnchor="middle" fontSize="16">
          MISSING
        </text>
        <path
          className="o"
          fill="#ffc93c"
          d="M88 112C88 92 136 92 136 112V128C136 148 88 148 88 128Z"
        />
        <path className="t" d="M112 96V112" />
        <path className="t" d="M112 96C112 84 124 88 124 78" />
        <rect className="o" x="105" y="22" width="14" height="28" rx="4" fill="#f59bd8" />
      </g>

      <path className="o" fill="none" d="M0 312H320" />

      <rect className="o" x="30" y="206" width="74" height="106" rx="12" fill="#fff" />
      <path className="t" d="M58 216H76" />
      <circle cx="54" cy="256" r="4" fill="#17131f" />
      <circle cx="80" cy="256" r="4" fill="#17131f" />
      <path className="t" d="M58 278C62 270 72 270 76 278" />
      <path
        d="M92 240C96 246 98 250 98 253C98 259 86 259 86 253C86 250 88 246 92 240Z"
        fill="#7cc7e8"
      />

      <path
        className="o"
        fill="#fff"
        d="M16 168H96C103 168 108 173 108 180V186C108 193 103 198 96 198H70L60 208L60 198H16C9 198 4 193 4 186V180C4 173 9 168 16 168Z"
      />
      <text x="56" y="188" textAnchor="middle" fontSize="14">
        SORRY.
      </text>

      <g transform="translate(150 -282) scale(1.04)">
        <path
          fill="#17131f"
          d="M24 570C14 520 20 486 32 462L26 428L52 446C62 442 72 442 82 446L108 428L104 462C118 490 124 530 118 570Z"
        />
        <ellipse cx="54" cy="478" rx="9" ry="7" fill="#fff" />
        <ellipse cx="84" cy="478" rx="9" ry="7" fill="#fff" />
        <ellipse cx="50" cy="475" rx="3.500" ry="5" fill="#17131f" />
        <ellipse cx="80" cy="475" rx="3.500" ry="5" fill="#17131f" />
        <path d="M65 490h8l-4 5Z" fill="#f59bd8" />
      </g>

      <path
        className="o"
        fill="#fff"
        d="M204 56H304C311 56 316 61 316 68V104C316 111 311 116 304 116H262L244 138L244 116H204C197 116 192 111 192 104V68C192 61 197 56 204 56Z"
      />
      <text x="254" y="82" textAnchor="middle" fontSize="15">
        I CHECKED.
      </text>
      <text x="254" y="102" textAnchor="middle" fontSize="15">
        NO MOUSE.
      </text>
    </svg>
  );
}
