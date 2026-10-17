/** Speech providers and official StepAudio voices; credentials are stored separately. */
export type SpeechService = 'step-plan' | 'worker';

export const STEP_PLAN_BASE_URL = 'https://api.stepfun.com/step_plan/v1';
export const STEP_PLAN_MODEL = 'stepaudio-2.5-tts';
export const STEP_PLAN_DEFAULT_VOICE = 'qinqienvsheng';
export const SPEECH_SERVICE_KEY = 'resonance_tts_provider';
export const STEP_PLAN_VOICE_KEY = 'resonance_step_plan_voice';

/** IDs confirmed in StepFun's official audio developer guide. */
export const STEP_PLAN_VOICES = [
  { id: 'qinqienvsheng', label: '亲切女声' },
  { id: 'wenrounvsheng', label: '温柔女声' },
  { id: 'cixingnansheng', label: '磁性男声' },
  { id: 'wenrounansheng', label: '温柔男声' },
  { id: 'linjiajiejie', label: '邻家姐姐' },
  { id: 'boyinnansheng', label: '播音男声' },
];
