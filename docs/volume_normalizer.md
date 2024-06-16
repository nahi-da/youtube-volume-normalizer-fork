### フォルダ階層
```plaintext
./
│ background.js
│ content.js
│ manifest.json
│ popup.js
│
├─content
│      amplify.js
│      dom-utils.js
│      info-panel.js
│      sys-vol.js
│
├─popup
│      popup.html
│
└─utils
       config.js
       db.js
       storage.js
```

### background.js

```js
'use strict';

import { storageLocalGet, storageLocalSet, storageSyncGet, storageSyncSet } from './utils/storage.js';
import Config from './utils/config.js'

function adjustSysVol(prevVol, newVol) {
    console.log('Youtube Volume Normalizer: Adjust system volume offset from ' + prevVol + 'dB to ' + newVol + 'dB');
    browser.runtime.sendNativeMessage('youtube.volume.normalizer', {prevDb: prevVol, newDb: newVol});
}

async function setTabVol(tabId, vol, inactive) {
    if (inactive) {
        await storageLocalSet('inactiveTabVol_' + tabId, vol);
    } else {
        await browser.storage.local.remove('inactiveTabVol_' + tabId);

        var activeTabsVol = await storageLocalGet('activeTabsVol', {});
        activeTabsVol[tabId] = vol;
        await storageLocalSet('activeTabsVol', activeTabsVol);

        const curGlobalVol = await storageLocalGet('curGlobalVol');
        if (curGlobalVol == null || vol < curGlobalVol) {
            await storageLocalSet('curGlobalVol', vol);
            adjustSysVol(curGlobalVol == null ? 0 : curGlobalVol, vol);
        }
    }
}

async function unsetTabVol(tabId, inactive) {
    var activeTabsVol = await storageLocalGet('activeTabsVol', {});

    if (tabId in activeTabsVol) {
        const curTabVol = activeTabsVol[tabId];
        delete activeTabsVol[tabId];
        await storageLocalSet('activeTabsVol', activeTabsVol);

        const curGlobalVol = await storageLocalGet('curGlobalVol');

        if (inactive) {
            await storageLocalSet('inactiveTabVol_' + tabId, curTabVol);
        }

        if (curTabVol == curGlobalVol) {
            const allVols = Object.values(activeTabsVol);
            if (allVols.length == 0) {
                await browser.storage.local.remove('curGlobalVol');
                adjustSysVol(curGlobalVol, 0);
            } else {
                const newGlobalVol = Math.min(...allVols);
                await storageLocalSet('curGlobalVol', newGlobalVol);
                adjustSysVol(curGlobalVol, newGlobalVol);
            }
        }
    } else {
        if (!inactive) {
            await browser.storage.local.remove('inactiveTabVol_' + tabId);
        }
    }
}

async function activateTabVol(tabId) {
    const inactiveTabVol = await storageLocalGet('inactiveTabVol_' + tabId);
    if (inactiveTabVol == null) {
        return;
    }
    await browser.storage.local.remove('inactiveTabVol_' + tabId);

    var activeTabsVol = await storageLocalGet('activeTabsVol', {});
    if (tabId in activeTabsVol) {
        return;
    }
    activeTabsVol[tabId] = inactiveTabVol;
    await storageLocalSet('activeTabsVol', activeTabsVol);

    const curGlobalVol = await storageLocalGet('curGlobalVol');
    if (curGlobalVol == null || inactiveTabVol < curGlobalVol) {
        await storageLocalSet('curGlobalVol', inactiveTabVol);
        adjustSysVol(curGlobalVol == null ? 0 : curGlobalVol, inactiveTabVol);
    }
}

async function getPeak(videoId) {
    const res = await storageSyncGet(videoId, [0, 0]);
    return res[0];
}

async function storePeak(videoId, peakRatio) {
    console.log('YouTube Volume Normalizer: Storing peak for ' + videoId + ' as ' + peakRatio);

    const timestamp = Date.now();
    while (true) {
        try {
            await storageSyncSet(videoId, [peakRatio, timestamp]);
            break;
        } catch (err) {
            const allPeaks = await browser.storage.sync.get(null);

            let smallestTimestamp = Infinity;
            let keyWithSmallestTimestamp = null;
            for (let key in allPeaks) {
                if (Config.isConfig(key)) {
                    continue;
                }

                if (allPeaks[key][1] < smallestTimestamp) {
                    smallestTimestamp = allPeaks[key][1];
                    keyWithSmallestTimestamp = key;
                }
            }
            if (keyWithSmallestTimestamp == null) {
                throw err;
            }
            await browser.storage.sync.remove(keyWithSmallestTimestamp);
        }
    }
}

function handleTabUpdated(tabId, changeInfo, tabInfo) {
    navigator.locks.request('events', async (lock) => {
        if (changeInfo.url) {
            await unsetTabVol(tabId, false);
        } else if ('audible' in changeInfo) {
            if (changeInfo.audible) {
                await activateTabVol(tabId);
            } else {
                await unsetTabVol(tabId, true);
            }
        }
    });
}

function handleTabRemoved(tabId, removeInfo) {
    navigator.locks.request('events', async (lock) => {
        await unsetTabVol(tabId, false);
    });
}

function handleMessage(message, sender, sendResponse) {
    return navigator.locks.request('events', async (lock) => {
        const tabId = sender.tab.id;

        if (message.type == 'applyGain') {
            await setTabVol(tabId, message.dB, !sender.tab.audible);
        } else if (message.type == 'revertGain') {
            await unsetTabVol(tabId, false);
        } else if (message.type == 'getPeak') {
            return getPeak(message.videoId);
        } else if (message.type == 'storePeak') {
            await storePeak(message.videoId, message.peakRatio);
        }
    });
}

async function reset() {
    const curGlobalVol = await storageLocalGet('curGlobalVol');
    if (curGlobalVol != null && curGlobalVol != 0) {
        adjustSysVol(curGlobalVol, 0);
    }

    await browser.storage.local.clear();
}

function handleInstalled() {
    navigator.locks.request('events', async (lock) => {
        console.log('YouTube Volume Normalizer: Installed and started');
        await reset();
    });
}

function handleStartup() {
    navigator.locks.request('events', async (lock) => {
        console.log('YouTube Volume Normalizer: Started');
        await reset();
    });
}

browser.runtime.onInstalled.addListener(handleInstalled);
browser.runtime.onStartup.addListener(handleStartup);
browser.tabs.onUpdated.addListener(handleTabUpdated);
browser.tabs.onRemoved.addListener(handleTabRemoved);
browser.runtime.onMessage.addListener(handleMessage);

```

### content.js

```js
'use strict';

import { InfoPanel } from './content/info-panel.js';
import { waitForElement } from './content/dom-utils.js';
import Config from './utils/config.js';
import { amplify } from './content/amplify.js';
import { sysVol } from './content/sys-vol.js';

(async function() {
    console.log('Youtube Volume Normalizer started');

    var videoEle = await waitForElement('.html5-main-video');

    var infoPanel = new InfoPanel();
    await infoPanel.init();

    const useSysVol = await Config.get('useSysVol', false);
    if (useSysVol) {
        sysVol(videoEle, infoPanel);
    } else {
        amplify(videoEle, infoPanel);
    }
})();
```

### manifest.json

```json
{
  "manifest_version": 2,
  "name": "YouTube Volume Normalizer (fork)",
  "version": "4.0.4",
  "homepage_url": "https://github.com/Kelvin-Ng/youtube-volume-normalizer",
  "description": "Normalize YouTube volume. This extension will increase the volume if it is too soft. YouTube by default will only lower the volume if it is too loud.",

  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["content.js"],
      "all_frames": true
    }
  ],

  "background": {
    "scripts": ["background.js"],
    "persistent": false
  },

  "browser_action": {
      "default_popup": "popup/popup.html"
  },

  "permissions": ["storage", "nativeMessaging", "tabs"]
}

```

### popup.js

```js
'use strict';

import Config from './utils/config.js';
import { storageSyncGet, storageSyncSet }from './utils/storage.js';

async function loadRadioYesNo(name) {
    const yesEle = document.getElementById(name + 'Yes');
    const noEle = document.getElementById(name + 'No');

    const isYes = await Config.get(name, false);

    if (isYes) {
        yesEle.checked = true;
    } else {
        noEle.checked = true;
    }

    yesEle.addEventListener('click', function() {
        Config.set(name, true);
    });
    noEle.addEventListener('click', function() {
        Config.set(name, false);
    });
}

(async function() {
    loadRadioYesNo('useSysVol');
    loadRadioYesNo('usePeak');

    const debugClearBtn = document.getElementById('debugClear');
    debugClearBtn.onclick = async (evt) => {
        await browser.storage.sync.clear();
    }

    const debugPrintBtn = document.getElementById('debugPrint');
    debugPrintBtn.onclick = async (evt) => {
        console.log(JSON.stringify(await browser.storage.sync.get(null)));
    }

    const showDebugBtn = document.getElementById('showDebug');
    const debugDiv = document.getElementById('debug');
    showDebugBtn.onclick = (evt) => {
        debugDiv.style.display = '';
    }
})();

```

### amplify.js

```js
'use strict';

import { InfoPanel } from './info-panel.js';

function updateVolume(audioGraph, infoPanel) {
    console.log('Youtube Volume Normalizer: New video');
    infoPanel.refresh();
    const dB = infoPanel.getDb();

    console.log('Youtube Volume Normalizer: Average volume: ' + dB + 'dB');

    if (dB >= 0) {
        console.log('Youtube Volume Normalizer: No amplification needed');
        // Reset to no gain because YouTube already normalize the volume when it is too loud
        if (!infoPanel.isUseDefault()) {
            console.log('Youtube Volume Normalizer: Disconnecting audio graph');
            audioGraph.disconnect();
            infoPanel.setUseDefault();
        }
    } else {
        audioGraph.set(dB);

        if (infoPanel.isUseDefault()) {
            console.log('Youtube Volume Normalizer: Connecting audio graph');
            audioGraph.connect();
            infoPanel.unsetUseDefault();
        }

        const actualGain = Math.pow(10, -dB / 20);
        infoPanel.update(actualGain);
        console.log('Youtube Volume Normalizer: Gain: ' + -dB + 'dB' + ' (' + actualGain * 100 + '%)');
    }
}

class AudioGraph {
    constructor(videoEle) {
        this.audioCtx = new AudioContext();

        this.limiterNode = this.audioCtx.createDynamicsCompressor();
        this.limiterNode.threshold.value = 0;
        this.limiterNode.knee.value = 0;
        this.limiterNode.ratio.value = 20.0;
        this.limiterNode.attack.value = 0.001;
        this.limiterNode.release.value = 0.1;

        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = 1.0;

        this.videoEleSource = this.audioCtx.createMediaElementSource(videoEle);
        this.videoEleSource.connect(this.audioCtx.destination);

        this.limiterNode.connect(this.gainNode);
    }

    set(dB) {
        // `dB` is the gain relative to YouTube preferred level (let's call the YouTube preferred level as 0dBYT)
        // We want to apply a gain of -`dB`dB so that the final volume is 0dBYT.

        // To avoid clipping, the maximum volume after amplification have to be below 0 LUFS.
        // That means, before amplification, we want to compress so that the maximum volume is below `dB` LUFS.
        // Considering the compresion curve, we want threshold - (1/ratio)*threshold < `dB`. Solving this equation yields the below formula:
        const ratio = this.limiterNode.ratio.value;
        this.limiterNode.threshold.value = ratio / (ratio - 1.0) * dB;

        // Then we do the actual amplification. However, the DynamicsCompressorNode will apply a makeup gain.
        // The makeup gain it applies is 0.6 * -(maximum gain according to compression curve).
        // (Ref.: https://webaudio.github.io/web-audio-api/#computing-the-makeup-gain)
        // We have set the threshold so that the maximum gain is `dB`dB.
        // So, the makeup gain is -0.6 * `dB`dB. So, we only need to apply a gain of -0.4 * `dB`dB so that the total gain is -`dB`dB.
        this.gainNode.gain.value = Math.pow(10, -0.4 * dB / 20);
    }

    connect() {
        this.videoEleSource.disconnect();
        this.videoEleSource.connect(this.limiterNode);
        this.gainNode.connect(this.audioCtx.destination);
    }

    disconnect() {
        this.gainNode.disconnect();
        this.videoEleSource.disconnect();
        this.videoEleSource.connect(this.audioCtx.destination);
    }
}

function amplify(videoEle, infoPanel) {
    var audioGraph = new AudioGraph(videoEle);

    updateVolume(audioGraph, infoPanel);

    const observer = new MutationObserver(mutations => {
        updateVolume(audioGraph, infoPanel);
    });

    observer.observe(videoEle, {
        attributeFilter: ['src',],
    });
}

export { amplify };

```

### dom-utils.js

```js
'use strict';

// https://stackoverflow.com/a/14284815
function getElementByXpath(path, contextNode) {
    return document.evaluate(path, contextNode, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// https://stackoverflow.com/a/61511955
function waitFor(func) {
    return new Promise(resolve => {
        const res = func();
        if (res) {
            return resolve(res);
        }

        const observer = new MutationObserver(mutations => {
            const res = func();
            if (res) {
                resolve(res);
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

function waitForElement(selector) {
    return waitFor(() => {
        return document.querySelector(selector);
    });
}

function waitForXpath(path, contextNode) {
    return waitFor(() => {
        return getElementByXpath(path, contextNode);
    });
}

export { getElementByXpath, waitFor, waitForElement, waitForXpath };

```

### info-panel.js

```js
'use strict';

import { getElementByXpath, waitFor, waitForElement, waitForXpath } from './dom-utils.js';

class InfoPanel {
    constructor() {
        this.myGain = 1;

        this.useDefault = true;

        this.observer = new MutationObserver(mutations => {
            this.update();
        });

        this.numToSkip = 0;
    }

    async init() {
        var moviePlayerEle = await waitForElement('#movie_player');
        var contextEvt = new MouseEvent('contextmenu');
        moviePlayerEle.dispatchEvent(contextEvt);

        var menuEle = await waitForElement('.ytp-contextmenu');
        this.menuItem = await waitForXpath('div/div/div[6]', menuEle);
        this.clickEvt = new MouseEvent('click');
        this.menuItem.dispatchEvent(this.clickEvt);
        this.closeButton = await waitForElement('.html5-video-info-panel-close');
        this.closeButton.dispatchEvent(this.clickEvt);
        this.panelContent = await waitForElement('.html5-video-info-panel-content');
        this.contentLoudnessEle = await waitForXpath('div[4]/span', this.panelContent);
        this.videoIdEle = await waitForElement('.ytp-sfn-cpn');

        this.observer.observe(this.contentLoudnessEle, {
            characterData: true,
            childList: true,
            subtree: true,
        });
    }

    refresh() {
        this.closeButton.dispatchEvent(this.clickEvt);
        this.menuItem.dispatchEvent(this.clickEvt);
        this.closeButton.dispatchEvent(this.clickEvt);
    }

    getDb() {
        var contentLoudnessStr = this.contentLoudnessEle.innerText.split(' ');
        if (contentLoudnessStr.length < 7) {
            return 0;
        }

        var dB = parseFloat(contentLoudnessStr[6].slice(0, -3));
        return dB;
    }

    getVideoId() {
        return this.videoIdEle.innerText.split(' / ')[0].trim();
    }

    setUseDefault() {
        this.useDefault = true;
    }

    unsetUseDefault() {
        this.useDefault = false;
    }

    isUseDefault() {
        return this.useDefault;
    }

    update(val) {
        if (this.numToSkip > 0) {
            this.numToSkip -= 1;
            return;
        }

        if (this.useDefault) {
            return;
        }

        if (typeof val !== 'undefined') {
            this.myGain = val;
        }

        var contentLoudnessStr = this.contentLoudnessEle.innerText.split(' ');
        if (contentLoudnessStr.length < 4) {
            return;
        }

        var basicGain = parseFloat(contentLoudnessStr[1].slice(0, -1)) / 100;
        var percentage = Math.round(this.myGain * basicGain * 100);
        this.contentLoudnessEle.innerText = this.contentLoudnessEle.innerText.replace(/ \/ \d+\%/i, ' / ' + percentage + '%'); // The regex means ' / X%'

        this.numToSkip += 1;
    }
}

export { InfoPanel };

```

### sys-vol.js

```js
'use strict';

import { InfoPanel } from './info-panel.js';
import Config from '../utils/config.js';
import { db2ratio, ratio2db } from '../utils/db.js';
import * as WebAudioPeakMeter from 'web-audio-peak-meter';

class Context {
    constructor(videoEle, infoPanel, audioPeakGraph) {
        this.maxPeakAfterGainDb = -1.;

        this.videoEle = videoEle;
        this.infoPanel = infoPanel;
        this.audioPeakGraph = audioPeakGraph;
    }

    async refresh() {
        this.infoPanel.refresh();
        if (this.audioPeakGraph) {
            this.audioPeakGraph.disconnect();
        }

        this.videoId = this.infoPanel.getVideoId();
        this.avgDb = this.infoPanel.getDb();
        this.peakRatio = 0;
        if (this.avgDb < 0) {
            this.gainDb = -this.avgDb;
            this.updatePeak(await this.getPeak());
        } else {
            this.gainDb = 0;
        }
        this.stream = null;
    }

    updatePeak(peakRatio) {
        //console.log('YouTube Volume Normalizer: updatePeak: ' + peakRatio); // too much output
        if (peakRatio > this.peakRatio) {
            //console.log('YouTube Volume Normalizer: New Peak detected: ' + this.peakRatio + ' -> ' + peakRatio); // too much output

            this.peakRatio = peakRatio;
            this.peakDb = ratio2db(this.peakRatio);

            if (this.avgDb < 0) {
                const peakAfterGainDb = this.peakDb - this.avgDb;
                if (peakAfterGainDb > this.maxPeakAfterGainDb) {
                    this.gainDb = this.maxPeakAfterGainDb - this.peakDb;
                    if (this.gainDb < 0) {
                        this.gainDb = 0;
                    }
                    //console.log('YouTube Volume Normalizer: Peak after gain is too high. New gain: ' + this.gainDb + 'dB'); // too much output
                } else {
                    this.gainDb = -this.avgDb;
                }

                if (!this.videoEle.paused && !this.videoEle.muted) {
                    this.applyGain();
                }
            }
        }
    }

    applyGain() {
        //console.log('YouTube Volume Normalizer: Applying gain: ' + this.gainDb + 'dB'); // too much output
        browser.runtime.sendMessage({type: 'applyGain', dB: this.gainDb});
    }

    revertGain() {
        console.log('YouTube Volume Normalizer: Reverting gain');
        browser.runtime.sendMessage({type: 'revertGain'});
    }

    storePeak() {
        if (this.peakRatio > 0) {
            console.log('YouTube Volume Normalizer: Store peak as ' + this.peakRatio);
            browser.runtime.sendMessage({type: 'storePeak', videoId: this.videoId, peakRatio: this.peakRatio});
        }
    }

    async getPeak() {
        const peakRatio = await browser.runtime.sendMessage({type: 'getPeak', videoId: this.videoId});
        return peakRatio;
    }
}

class AudioPeakGraph {
    constructor(audioCtx) {
        this.audioCtx = audioCtx;
    }

    updateSource(source, callback) {
        this.source = source;

        this.meterNode = WebAudioPeakMeter.createMeterNode(this.source, this.audioCtx);
        WebAudioPeakMeter.createMeter(null, this.meterNode, {}, callback);
    }

    disconnect() {
        if (this.source != null) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.meterNode != null) {
            this.meterNode.onaudioprocess = null;
            this.meterNode = null;
        }
        this.audioCtx.suspend();
    }
}

function tryUpdateAudioPeakGraphSource(context) {
    if (context.stream == null) {
        context.stream = context.videoEle.captureStream();
        if (context.stream.getAudioTracks().length == 0) {
            context.addTrackListener = (evt) => {
                tryUpdateAudioPeakGraphSource(context);
            };
            context.stream.addEventListener('addtrack', context.addTrackListener);
            return;
        }
    }

    console.log('YouTube Volume Normalizer: New track detected');

    if (context.stream.getAudioTracks().length == 0) {
        return;
    }

    context.audioPeakGraph.updateSource(context.audioPeakGraph.audioCtx.createMediaStreamSource(context.stream), (metaData) => {
        context.updatePeak(Math.max(...metaData.heldPeaks));
    });

    context.stream.removeEventListener('addtrack', context.addTrackListener)
}

async function videoSrcUpdated(context) {
    console.log('YouTube Volume Normalizer: Video source updated');

    await context.refresh();

    console.log('YouTube Volume Normalizer: Video ID: ' + context.videoId);

    if (context.avgDb < 0 && context.audioPeakGraph) {
        tryUpdateAudioPeakGraphSource(context);
    }

    if (!context.videoEle.paused && !context.videoEle.muted) {
        context.applyGain();
    }
}

function videoPlayed(evt, context) {
    if (context.audioPeakGraph != null && context.avgDb < 0) {
        context.audioPeakGraph.audioCtx.resume();
    }

    if (!context.videoEle.muted) {
        context.applyGain();
    }
}

function videoPaused(evt, context) {
    if (context.audioPeakGraph != null) {
        context.audioPeakGraph.audioCtx.suspend();
    }

    context.revertGain();
}

function videoVolumeChange(evt, context) {
    if (context.videoEle.muted) {
        context.videoEle.revertGain();
    } else {
        context.videoEle.applyGain();
    }
}

async function sysVol(videoEle, infoPanel) {
    if (!videoEle.captureStream) {
        videoEle.captureStream = videoEle.mozCaptureStream;
    }

    const usePeak = await Config.get('usePeak', false);
    let audioPeakGraph = null;
    if (usePeak) {
        const audioCtx = new AudioContext();
        audioPeakGraph = new AudioPeakGraph(audioCtx);
    }

    const context = new Context(videoEle, infoPanel, audioPeakGraph);

    videoSrcUpdated(context);

    const observer = new MutationObserver(mutations => {
        if (usePeak) {
            context.storePeak();
        }
        videoSrcUpdated(context);
    });

    observer.observe(videoEle, {
        attributeFilter: ['src',],
    });

    videoEle.addEventListener('play', (evt) => {
        videoPlayed(evt, context);
    });
    videoEle.addEventListener('pause', (evt) => {
        videoPaused(evt, context);
    });
    videoEle.addEventListener('ended', (evt) => {
        videoPaused(evt, context);
    });
    videoEle.addEventListener('volumechange', (evt) => {
        videoVolumeChange(evt, context);
    });

    window.addEventListener('unload', (evt) => {
        console.log('YouTube Volume Normalizer: Unloading, storing peak');
        if (usePeak) {
            context.storePeak();
        }
    });
}

export { sysVol };

```

### popup.html

```html
<html>
    <body>
        <input type="radio" name="useSysVol" id="useSysVolYes"/>
        <label for="useSysVolYes">Adjust system volume</label>
        <input type="radio" name="useSysVol" id="useSysVolNo"/>
        <label for="useSysVolNo">Amplify audio</label>

        <br/>

        <a>Adjust according to peak volume: </a>
        <input type="radio" name="usePeak" id="usePeakYes"/>
        <label for="usePeakYes">Yes</label>
        <input type="radio" name="usePeak" id="usePeakNo"/>
        <label for="usePeakNo">No</label>

        <br/>

        <hr class="solid"/>

        <button id="showDebug">Show debug options</button>
        <div id="debug" style="display: none">
            <br/>
            <a>Sync Storage</a>
            <button id="debugClear">Clear</button>
            <button id="debugPrint">Print</button>
        </div>
    </body>
    <script src="../popup.js"></script>
</html>
```

### config.js

```js
'use strict';

import { storageSyncGet, storageSyncSet } from './storage.js';

export default class Config {
    static get(key, defaultVal = null) {
        return storageSyncGet('__config_' + key, defaultVal);
    }

    static set(key, val) {
        return storageSyncSet('__config_' + key, val);
    }

    static isConfig(key) {
        return key.slice(0, 9) == '__config_';
    }
}

```

### db.js

```js
function db2ratio(db) {
    return 10. ** (db / 20.);
}
function ratio2db(ratio) {
    return 20. * Math.log10(ratio);
}

export { db2ratio, ratio2db };

```

### storage.js

```js
'use strict';

async function storageSyncGet(key, defaultVal = null) {
    var item = await browser.storage.sync.get({[key]: defaultVal});
    return item[key];
}

function storageSyncSet(key, val) {
    return browser.storage.sync.set({[key]: val});
}

async function storageLocalGet(key, defaultVal = null) {
    var item = await browser.storage.local.get({[key]: defaultVal});
    return item[key];
}

function storageLocalSet(key, val) {
    return browser.storage.local.set({[key]: val});
}

export { storageSyncGet, storageSyncSet, storageLocalGet, storageLocalSet };

```
