import { GAME_CONFIG } from './config.js';

// Stage definitions
export const STAGE_1 = 0; // Bản chất CNXH
export const STAGE_2 = 1; // Thời kỳ quá độ
export const STAGE_3 = 2; // Việt Nam đi lên CNXH

export function getStageFromQuestionCount(correctAnswers) {
    if (correctAnswers < 7) {
        return STAGE_1;
    } else if (correctAnswers < 13) {
        return STAGE_2;
    } else {
        return STAGE_3;
    }
}

export function getEnvironmentFromStage(stage, colors) {
    switch (stage) {
        case STAGE_1:
            return {
                waterColor: colors.zone1,
                waveAmplitude: 0.5,
                waveFrequency: 1.0,
                windSpeed: 0.1,
                name: "BẢN CHẤT CHỦ NGHĨA XÃ HỘI"
            };
        case STAGE_2:
            return {
                waterColor: colors.zone2,
                waveAmplitude: 2.6,
                waveFrequency: 3.5,
                windSpeed: 0.45,
                name: "THỜI KỲ QUÁ ĐỘ LÊN CHỦ NGHĨA XÃ HỘI"
            };
        case STAGE_3:
            return {
                waterColor: colors.zone3,
                waveAmplitude: 0.4,
                waveFrequency: 0.8,
                windSpeed: 0.08,
                name: "VIỆT NAM VÀ ĐƯỜNG LÊN CNXH"
            };
        default:
            return {
                waterColor: colors.zone1,
                waveAmplitude: 0.5,
                waveFrequency: 1.0,
                windSpeed: 0.1,
                name: "BẢN CHẤT CHỦ NGHĨA XÃ HỘI"
            };
    }
}

export function calculateZPosition(progress) {
    return GAME_CONFIG.START_Z - (progress * GAME_CONFIG.TOTAL_DIST);
}
