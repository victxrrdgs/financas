// Ícones de linha das categorias (traço 1.8, no estilo da barra de navegação), desenhados a partir do Lucide (ISC).
// A chave é o emoji padrão da categoria em calc.js; categorias criadas pela pessoa continuam com o emoji dela.
const P = {
  '🏠': '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  '🛒': '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.8a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/>',
  '🍔': '<path d="M3 11h18M4 15h16a0 0 0 0 1 0 0 3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M4 11a8 6 0 0 1 16 0"/>',
  '🚗': '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/><path d="M5 12h14"/>',
  '💊': '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="m9.2 9.2 5.6 5.6"/>',
  '📚': '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h8"/>',
  '🎮': '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/>',
  '🛍️': '<path d="M5 7h14l-1 14H6z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  '📺': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m8 3 4 3 4-3"/>',
  '💡': '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  '🧾': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  '💳': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  '📦': '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  '💰': '<path d="M12 2v20M17 6.5c-1-1.5-3-2-5-2-2.8 0-4.5 1.3-4.5 3.2 0 4.5 10 2.4 10 7 0 2-1.9 3.3-5 3.3-2.3 0-4.3-.8-5.5-2.5"/>',
};

// Devolve o SVG da categoria pelo emoji padrão; sem ícone, devolve o próprio emoji.
export const icone = (emoji) => (P[emoji] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${P[emoji]}</svg>` : emoji);
