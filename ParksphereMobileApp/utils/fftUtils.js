/**
 * Lightweight FFT Utility (Iterative Radix-2)
 * Pure JavaScript for zero-dependency portability.
 */

export function fft(real, imag) {
    const n = real.length;
    if (n !== imag.length) throw new Error("Arrays must be same length");
    if ((n & (n - 1)) !== 0) throw new Error("Length must be power of 2");

    // Bit-reversal permutation
    for (let i = 0, j = 0; i < n; i++) {
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
        let m = n >> 1;
        while (m >= 1 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    // Butterfly computations
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (2 * Math.PI) / len;
        const wlen_real = Math.cos(ang);
        const wlen_imag = -Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let w_real = 1;
            let w_imag = 0;
            for (let j = 0; j < len / 2; j++) {
                const u_real = real[i + j];
                const u_imag = imag[i + j];
                const v_real = real[i + j + len / 2] * w_real - imag[i + j + len / 2] * w_imag;
                const v_imag = real[i + j + len / 2] * w_imag + imag[i + j + len / 2] * w_real;
                real[i + j] = u_real + v_real;
                imag[i + j] = u_imag + v_imag;
                real[i + j + len / 2] = u_real - v_real;
                imag[i + j + len / 2] = u_imag - v_imag;
                const next_w_real = w_real * wlen_real - w_imag * wlen_imag;
                w_imag = w_real * wlen_imag + w_imag * wlen_real;
                w_real = next_w_real;
            }
        }
    }
}

/**
 * Extract spectral features from a raw signal (e.g. Accel magnitude)
 * @param {Array} signal - Time-domain signal (e.g. 128 samples)
 * @param {number} sampleRate - Hz (e.g. 50)
 */
export function extractSpectralFeatures(signal, sampleRate) {
    const n = signal.length;
    const real = [...signal];
    const imag = new Array(n).fill(0);

    // Apply Hanning Window to reduce leakage
    for (let i = 0; i < n; i++) {
        const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
        real[i] *= win;
    }

    fft(real, imag);

    const magnitudes = new Array(n / 2).fill(0);
    let totalEnergy = 0;

    for (let i = 0; i < n / 2; i++) {
        magnitudes[i] = Math.sqrt(real[i] ** 2 + imag[i] ** 2);
        totalEnergy += magnitudes[i];
    }

    // Frequency resolution
    const binSize = sampleRate / n;

    // Feature 1: Walking Band (1.5 - 2.5 Hz)
    let walkingEnergy = 0;
    const walkStart = Math.floor(1.0 / binSize);
    const walkEnd = Math.ceil(3.0 / binSize);
    for (let i = walkStart; i <= walkEnd && i < magnitudes.length; i++) {
        walkingEnergy += magnitudes[i];
    }

    // Feature 2: Vehicle/Engine Band (10 - 25 Hz)
    let vehicleEnergy = 0;
    const vehStart = Math.floor(10.0 / binSize);
    const vehEnd = Math.ceil(25.0 / binSize);
    for (let i = vehStart; i <= vehEnd && i < magnitudes.length; i++) {
        vehicleEnergy += magnitudes[i];
    }

    // Feature 3: Spectral Entropy (Measure of complexity/noise)
    let entropy = 0;
    if (totalEnergy > 0) {
        for (let i = 1; i < n / 2; i++) {
            const p = magnitudes[i] / (totalEnergy - magnitudes[0]); // Ignore DC component
            if (p > 0) {
                entropy -= p * Math.log2(p);
            }
        }
        entropy /= Math.log2(n / 2 - 1); // Normalize
    }

    return {
        walkingEnergy: walkingEnergy / (totalEnergy || 1),
        vehicleEnergy: vehicleEnergy / (totalEnergy || 1),
        spectralEntropy: entropy,
        dominantFreq: magnitudes.indexOf(Math.max(...magnitudes.slice(1))) * binSize
    };
}
