# The narration test (D131)

Before the walkthrough is built, this tests whether spoken notes are as good as typed ones. The author talks through screenshots they've already noted by typing, while pointing at what they mean. Their words and the pointer's path are then turned into notes, as the walkthrough would make them, and compared with the typed notes on the same screens.

## Recording

1. On Your rules, Export, and unzip the file.
2. Serve the recorder from localhost (the microphone needs a secure context):

   ```bash
   node scripts/voice-test/serve.mjs
   ```

3. In Chrome, open http://localhost:3120, pick about ten files from the export's `images/` folder (screens with several notes work best), and Start.
4. Talk through each screen as you would to a designer beside you: what works, what doesn't, why, and whose product it is. Point at what you mean, and rest the pointer on it while you say "this". Don't look at your typed notes first.
5. Use the down arrow, Space or a scroll for the next screen, and the up arrow to go back. Finish saves `pinch-voice-<time>.json` to Downloads.

The file holds the audio, when each screen was shown, every click, and the pointer's path as fractions of the screenshot (`[ms, screen, x, y]`, with `null` when it's off the image). Nothing leaves the browser.

## What's compared

- **Coverage.** How many of the typed notes' points come back in the spoken ones, and what the spoken ones add.
- **Place.** Whether a spoken note's dot or area lands on the same element as the typed note's.
- **Time.** Minutes of narration for the batch, beside the typing.
- **Rules.** The rules the reading makes from each set.

The words are transcribed on this machine, with word timings, so they can be matched to the pointer.
