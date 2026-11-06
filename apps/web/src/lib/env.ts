/** Build-time switches. Read once; components import the values instead of touching import.meta. */
export const SHOW_RESET: boolean = import.meta.env.VITE_SHOW_RESET === 'true';
