const MEMORY_KEY = 'matchvision_memory';

export function loadMemory() {
  return JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]');
}

export async function saveMemory(entry) {
  // Local fallback standing in for Redis during demo.
  const memory = [entry, ...loadMemory()].slice(0, 5);
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  return memory;
}
