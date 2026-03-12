import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";

let initialized = false;

export function initializeProviders() {
  if (initialized) return;

  if (process.env.OPENAI_API_KEY) {
    setDefaultAIProvider(new OpenAIProvider());
  } else if (process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(new GeminiProvider());
  }

  if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(new SeedanceProvider());
  }

  initialized = true;
}
