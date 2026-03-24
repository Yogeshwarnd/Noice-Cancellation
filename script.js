const audioFileInput = document.getElementById("audioFile");
const originalAudio = document.getElementById("originalAudio");
const cleanedAudio = document.getElementById("cleanedAudio");
const playOriginalBtn = document.getElementById("playOriginalBtn");
const pauseOriginalBtn = document.getElementById("pauseOriginalBtn");
const playCleanedBtn = document.getElementById("playCleanedBtn");
const pauseCleanedBtn = document.getElementById("pauseCleanedBtn");
const loadSampleBtn = document.getElementById("loadSampleBtn");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdValue = document.getElementById("thresholdValue");
const filterPreset = document.getElementById("filterPreset");
const durationLabel = document.getElementById("durationLabel");
const fileTypeLabel = document.getElementById("fileTypeLabel");
const removedLabel = document.getElementById("removedLabel");

const chartColors = {
  text: "#eef4ff",
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.18)",
  original: "#67e8f9",
  cleaned: "#f59e0b",
  spectrum: "#34d399"
};

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

let originalBuffer = null;
let cleanedBuffer = null;
let originalWave = null;
let cleanedWave = null;
let originalSpectrum = null;
let cleanedSpectrum = null;
let originalObjectUrl = null;
let cleanedObjectUrl = null;

function nearestPowerOfTwo(value) {
  return 2 ** Math.floor(Math.log2(Math.max(2, value)));
}

function formatDuration(seconds) {
  return `${seconds.toFixed(2)} s`;
}

function downsample(data, maxPoints = 1600) {
  const step = Math.max(1, Math.floor(data.length / maxPoints));
  const result = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  return result;
}

// Fourier Transform converts a time signal into its frequency components.
// We use FFT because it is fast enough to run in the browser.
function fft(real, imag) {
  const size = real.length;
  if (size <= 1) return;

  const half = size / 2;
  const evenReal = new Float64Array(half);
  const evenImag = new Float64Array(half);
  const oddReal = new Float64Array(half);
  const oddImag = new Float64Array(half);

  for (let i = 0; i < half; i++) {
    evenReal[i] = real[i * 2];
    evenImag[i] = imag[i * 2];
    oddReal[i] = real[i * 2 + 1];
    oddImag[i] = imag[i * 2 + 1];
  }

  fft(evenReal, evenImag);
  fft(oddReal, oddImag);

  for (let k = 0; k < half; k++) {
    const angle = (-2 * Math.PI * k) / size;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tempReal = cos * oddReal[k] - sin * oddImag[k];
    const tempImag = sin * oddReal[k] + cos * oddImag[k];

    real[k] = evenReal[k] + tempReal;
    imag[k] = evenImag[k] + tempImag;
    real[k + half] = evenReal[k] - tempReal;
    imag[k + half] = evenImag[k] - tempImag;
  }
}

// Inverse Fourier Transform rebuilds the signal after we remove noise.
function ifft(real, imag) {
  for (let i = 0; i < imag.length; i++) {
    imag[i] = -imag[i];
  }

  fft(real, imag);

  for (let i = 0; i < real.length; i++) {
    real[i] /= real.length;
    imag[i] = -imag[i] / real.length;
  }
}

function setupCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;

  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawFrame(ctx, width, height, title, xLabel, yLabel) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(6, 11, 22, 0.92)";
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 58, right: 18, top: 32, bottom: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  ctx.strokeStyle = chartColors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = margin.top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
  }

  for (let i = 0; i <= 5; i++) {
    const x = margin.left + (plotWidth * i) / 5;
    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, height - margin.bottom);
    ctx.stroke();
  }

  ctx.strokeStyle = chartColors.axis;
  ctx.strokeRect(margin.left, margin.top, plotWidth, plotHeight);

  ctx.fillStyle = chartColors.text;
  ctx.font = "600 16px Segoe UI";
  ctx.fillText(title, margin.left, 20);
  ctx.font = "12px Segoe UI";
  ctx.fillText(xLabel, width / 2 - 36, height - 10);

  ctx.save();
  ctx.translate(18, height / 2 + 20);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  return { margin, plotWidth, plotHeight };
}

function drawSeries(ctx, frame, values, color, minY, maxY) {
  if (!values.length) return;

  const span = maxY - minY || 1;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < values.length; i++) {
    const x = frame.margin.left + (i / Math.max(1, values.length - 1)) * frame.plotWidth;
    const normalized = (values[i] - minY) / span;
    const y = frame.margin.top + (1 - normalized) * frame.plotHeight;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function drawWaveform(canvasId, data, title, color) {
  const { ctx, width, height } = setupCanvas(canvasId);
  const frame = drawFrame(ctx, width, height, title, "Time (seconds)", "Amplitude");
  drawSeries(ctx, frame, downsample(data), color, -1, 1);
}

function drawSpectrum(magnitudes) {
  const { ctx, width, height } = setupCanvas("spectrumChart");
  const frame = drawFrame(ctx, width, height, "Frequency Spectrum", "Frequency (Hz)", "Magnitude");
  const half = Math.floor(magnitudes.length / 2);
  const values = [];
  for (let i = 0; i < half; i += Math.max(1, Math.floor(half / 1200))) {
    values.push(magnitudes[i]);
  }
  const max = Math.max(...values, 1);
  drawSeries(ctx, frame, values, chartColors.spectrum, 0, max);
}

function drawComparison(original, cleaned) {
  const { ctx, width, height } = setupCanvas("comparisonChart");
  const frame = drawFrame(ctx, width, height, "Original vs Cleaned Waveform", "Time (seconds)", "Amplitude");
  drawSeries(ctx, frame, downsample(original), chartColors.original, -1, 1);
  drawSeries(ctx, frame, downsample(cleaned), chartColors.cleaned, -1, 1);
}

function drawSpectrogram(data, sampleRate) {
  const frameSize = 256;
  const hop = 128;
  const columns = [];

  for (let start = 0; start + frameSize <= data.length; start += hop * 8) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);

    for (let i = 0; i < frameSize; i++) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
      real[i] = data[start + i] * window;
    }

    fft(real, imag);

    const column = [];
    for (let i = 0; i < frameSize / 2; i++) {
      column.push(20 * Math.log10(Math.hypot(real[i], imag[i]) + 1e-6));
    }
    columns.push(column);
  }

  const { ctx, width, height } = setupCanvas("spectrogramChart");
  const chart = drawFrame(ctx, width, height, "Spectrogram", "Time (seconds)", "Frequency (Hz)");

  if (!columns.length) return;

  let min = Infinity;
  let max = -Infinity;
  for (const column of columns) {
    for (const value of column) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  for (let x = 0; x < columns.length; x++) {
    for (let y = 0; y < columns[x].length; y++) {
      const normalized = (columns[x][y] - min) / ((max - min) || 1);
      const r = Math.floor(255 * normalized);
      const g = Math.floor(180 * (1 - Math.abs(normalized - 0.5) * 2));
      const b = Math.floor(255 * (1 - normalized));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const drawX = chart.margin.left + (x / columns.length) * chart.plotWidth;
      const drawY = chart.margin.top + (1 - (y + 1) / columns[x].length) * chart.plotHeight;
      ctx.fillRect(drawX, drawY, Math.ceil(chart.plotWidth / columns.length), Math.ceil(chart.plotHeight / columns[x].length));
    }
  }
}

function extractSpectrum(channelData) {
  const fftSize = nearestPowerOfTwo(Math.min(channelData.length, 8192));
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let i = 0; i < fftSize; i++) {
    real[i] = channelData[i] || 0;
  }

  fft(real, imag);

  const magnitudes = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    magnitudes[i] = Math.hypot(real[i], imag[i]);
  }
  return magnitudes;
}

function processChannel(channelData, sampleRate, thresholdPercent, preset) {
  const frameSize = 1024;
  const hopSize = 512;
  const output = new Float32Array(channelData.length);
  const normalization = new Float32Array(channelData.length);
  const spectrumAccumulator = new Float64Array(frameSize);
  let removedBins = 0;
  let totalBins = 0;
  let frameCount = 0;

  for (let start = 0; start < channelData.length; start += hopSize) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);
    const window = new Float64Array(frameSize);

    for (let i = 0; i < frameSize; i++) {
      const sourceIndex = start + i;
      const sample = sourceIndex < channelData.length ? channelData[sourceIndex] : 0;
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
      real[i] = sample * window[i];
    }

    fft(real, imag);

    let frameMax = 0;
    for (let k = 0; k < frameSize / 2; k++) {
      const magnitude = Math.hypot(real[k], imag[k]);
      spectrumAccumulator[k] += magnitude;
      if (magnitude > frameMax) frameMax = magnitude;
    }

    const magnitudeThreshold = (thresholdPercent / 100) * frameMax;
    const cutoff = (thresholdPercent / 100) * (sampleRate / 2);

    // Noise removal modifies Fourier coefficients before inverse FFT.
    for (let k = 1; k < frameSize / 2; k++) {
      const magnitude = Math.hypot(real[k], imag[k]);
      const frequency = (k * sampleRate) / frameSize;
      let remove = false;

      if (preset === "magnitude") {
        remove = magnitude < magnitudeThreshold;
      } else if (preset === "lowpass") {
        remove = frequency > cutoff;
      } else if (preset === "highpass") {
        remove = frequency < cutoff;
      }

      totalBins++;
      if (remove) {
        real[k] = 0;
        imag[k] = 0;
        real[frameSize - k] = 0;
        imag[frameSize - k] = 0;
        removedBins++;
      }
    }

    ifft(real, imag);

    for (let i = 0; i < frameSize; i++) {
      const targetIndex = start + i;
      if (targetIndex >= channelData.length) break;
      output[targetIndex] += real[i] * window[i];
      normalization[targetIndex] += window[i] * window[i];
    }

    frameCount++;
  }

  for (let i = 0; i < output.length; i++) {
    if (normalization[i] > 0) {
      output[i] /= normalization[i];
    }
    output[i] = Math.max(-1, Math.min(1, output[i]));
  }

  for (let i = 0; i < spectrumAccumulator.length; i++) {
    spectrumAccumulator[i] /= Math.max(1, frameCount);
  }

  return {
    output,
    removedPercentage: totalBins ? (removedBins / totalBins) * 100 : 0,
    spectrum: spectrumAccumulator
  };
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const wav = new ArrayBuffer(44 + samples * blockAlign);
  const view = new DataView(wav);

  function writeString(offset, text) {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples * blockAlign, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples * blockAlign, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([wav], { type: "audio/wav" });
}

function updateCharts() {
  drawWaveform("waveformChart", originalWave || new Float32Array([0]), "Original Waveform", chartColors.original);
  drawSpectrum(cleanedSpectrum || originalSpectrum || new Float64Array([0, 0]));
  drawComparison(originalWave || new Float32Array([0]), cleanedWave || originalWave || new Float32Array([0]));
  if (originalWave) {
    drawSpectrogram(originalWave, originalBuffer.sampleRate);
  }
}

async function applyNoiseRemoval() {
  if (!originalBuffer) return;

  await audioContext.resume();

  const threshold = Number(thresholdSlider.value);
  thresholdValue.textContent = `${threshold}%`;

  const outputBuffer = audioContext.createBuffer(
    originalBuffer.numberOfChannels,
    originalBuffer.length,
    originalBuffer.sampleRate
  );

  let removedPercent = 0;

  for (let channel = 0; channel < originalBuffer.numberOfChannels; channel++) {
    const result = processChannel(
      originalBuffer.getChannelData(channel),
      originalBuffer.sampleRate,
      threshold,
      filterPreset.value
    );

    outputBuffer.getChannelData(channel).set(result.output);

    if (channel === 0) {
      cleanedWave = result.output;
      cleanedSpectrum = result.spectrum;
      removedPercent = result.removedPercentage;
    }
  }

  cleanedBuffer = outputBuffer;
  removedLabel.textContent = `${removedPercent.toFixed(1)}%`;

  if (cleanedObjectUrl) {
    URL.revokeObjectURL(cleanedObjectUrl);
  }

  cleanedObjectUrl = URL.createObjectURL(encodeWav(cleanedBuffer));
  cleanedAudio.src = cleanedObjectUrl;
  cleanedAudio.load();
  playCleanedBtn.disabled = false;
  pauseCleanedBtn.disabled = false;

  updateCharts();
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    await loadAudioFromFile(file);
  } catch (error) {
    console.error(error);
    alert("The audio file could not be processed. Please try a WAV or MP3 file.");
  }
}

async function loadAudioFromFile(file) {
  await audioContext.resume();

  if (originalObjectUrl) {
    URL.revokeObjectURL(originalObjectUrl);
  }
  if (cleanedObjectUrl) {
    URL.revokeObjectURL(cleanedObjectUrl);
    cleanedObjectUrl = null;
  }

  const arrayBuffer = await file.arrayBuffer();
  originalBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  originalWave = new Float32Array(originalBuffer.getChannelData(0));
  cleanedWave = null;
  cleanedBuffer = null;
  originalSpectrum = extractSpectrum(originalWave);
  cleanedSpectrum = null;

  originalObjectUrl = URL.createObjectURL(file);
  originalAudio.src = originalObjectUrl;
  originalAudio.load();
  cleanedAudio.removeAttribute("src");
  cleanedAudio.load();

  durationLabel.textContent = formatDuration(originalBuffer.duration);
  fileTypeLabel.textContent = file.name.split(".").pop().toUpperCase();
  removedLabel.textContent = "0%";

  playOriginalBtn.disabled = false;
  pauseOriginalBtn.disabled = false;
  applyFilterBtn.disabled = false;
  playCleanedBtn.disabled = true;
  pauseCleanedBtn.disabled = true;

  updateCharts();
  await applyNoiseRemoval();
}

audioFileInput.addEventListener("change", handleFileUpload);

loadSampleBtn.addEventListener("click", async () => {
  try {
    const response = await fetch("sample-audio.wav");
    const blob = await response.blob();
    const file = new File([blob], "sample-audio.wav", { type: "audio/wav" });
    await loadAudioFromFile(file);
  } catch (error) {
    console.error(error);
    alert("Sample audio could not be loaded.");
  }
});

thresholdSlider.addEventListener("input", async () => {
  thresholdValue.textContent = `${thresholdSlider.value}%`;
  if (originalBuffer) {
    await applyNoiseRemoval();
  }
});

filterPreset.addEventListener("change", async () => {
  if (originalBuffer) {
    await applyNoiseRemoval();
  }
});

applyFilterBtn.addEventListener("click", applyNoiseRemoval);

playOriginalBtn.addEventListener("click", async () => {
  await audioContext.resume();
  cleanedAudio.pause();
  originalAudio.play();
});

pauseOriginalBtn.addEventListener("click", () => {
  originalAudio.pause();
});

playCleanedBtn.addEventListener("click", async () => {
  await audioContext.resume();
  originalAudio.pause();
  cleanedAudio.play();
});

pauseCleanedBtn.addEventListener("click", () => {
  cleanedAudio.pause();
});

window.addEventListener("resize", () => {
  updateCharts();
});

window.addEventListener("beforeunload", () => {
  if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl);
  if (cleanedObjectUrl) URL.revokeObjectURL(cleanedObjectUrl);
});

thresholdValue.textContent = `${thresholdSlider.value}%`;
updateCharts();
