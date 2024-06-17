# YouTube Volume Normalizer

This extension normalizes YouTube volume by increasing the volume if it is too soft. YouTube by default will only lower the volume if it is too loud.

This extension simulates mouse clicks to obtain the statistics of the video, which shows the content loudness relative to the YouTube preferred level. For example, the below screenshot shows a video with content loudness of -8.0dB before applying this extension (as highlighted):
![Video statistics before using this extension](docs/stats_before.png)

With this extension, if the content loudness is below 0 dB, either the audio will be amplified. For example, if it is -8.0 dB, a gain of 8.0 dB will be applied, and the loundness will become $10^\frac{8}{20} \times 100\\% = 251\\%$ of the original volume. See the below screenshot:
![Video statistics after using this extension](/nahi-da/youtube-volume-normalizer-fork/blob/master/docs/stats_after.png)

## Amplification

Under this mode, the audio will be amplified to the YouTube preferred level.

However, this can cause clipping because the volume after amplification may go beyond the maximum volume. To handle that, a dynamic compressor is used as a limiter to avoid clipping.

### Pros:

This mode will not affect concurrent playback (e.g., if you play YouTube video when you are in a video conference).

### Cons:

Amplification can hurt audio quality in two ways:

1. The dynamic compressor may slightly change the sound.

2. If the system volume is below 100%, the volume is first increased and then reduced. This can cause a lost in accuracy due to numerical error. In contrast, simply tune up the system volume when the audio is too soft will not suffer from this problem.

The above problems are not audible to my ears, but they may be audible to audiophiles.
