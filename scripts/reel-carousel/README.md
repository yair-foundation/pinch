# Reel carousel

A WebGL2 ring of image cards for a homepage hero, after the first two seconds of a reference clip: the ring zooms in from a speck while spinning hard with motion blur, settles on a card by about 1.7 s, then drifts. It can be dragged and flicked. It has no dependencies and lives in a single file, [reel-carousel.js](reel-carousel.js).

```bash
node scripts/reel-carousel/serve.mjs
```

Then open http://localhost:3121. Drop images on the page or pick them with **+** to see your own on the ring. You can also pass URLs: `?images=/a.jpg,/b.jpg`.

## Use

```js
import { createReelCarousel } from "./reel-carousel.js"

const reel = createReelCarousel(document.querySelector("canvas"), {
  images: ["/work/one.jpg", "/work/two.jpg", "/work/three.jpg"],
})

reel.setImages(newList) // URLs, <img>, <canvas>, ImageBitmap or File/Blob
reel.replay() // run the intro again
reel.destroy() // stop, unbind, free the textures and the context
```

The canvas is transparent, so give it the background colour, and size it with CSS. Each image fills its card like `object-fit: cover`. Images from another origin need CORS headers. With fewer images than `minCards`, the ring repeats them without putting the same image on two neighbouring cards.

| Option                        | Default           |                                                   |
| ----------------------------- | ----------------- | ------------------------------------------------- |
| `minCards`                    | 10                | cards on the ring when there are fewer images     |
| `cardAspect`                  | 1.1               | card width / height                               |
| `gap`                         | 0.14              | space between cards, as a share of a card's width |
| `autoSpeed`                   | -0.09             | drift in radians a second; negative drifts left   |
| `intro`                       | true              | zoom-and-spin entrance                            |
| `introSpin` / `introDuration` | 1.5 turns / 1.7 s | how far and how long it spins in                  |
| `shutter`                     | 1/40 s            | how much motion each frame smears                 |
| `pitch` / `roll`              | -0.24 / -0.07     | lean of the ring, in radians                      |

The intro is skipped and the drift stops when the visitor prefers reduced motion. Drawing pauses while the canvas is off screen. Motion blur draws the ring several times across the shutter and adds the copies together, up to `maxSamples` (32), and only while it moves fast.
