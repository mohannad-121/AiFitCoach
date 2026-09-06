import { useTheme } from '@/contexts/ThemeContext';
import './ThemeToggle.css';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const light = theme === 'light';

  return (
    <label className="bb8-toggle" title={light ? 'Switch to dark mode' : 'Switch to light mode'}>
      <input
        className="bb8-toggle__checkbox"
        type="checkbox"
        checked={light}
        onChange={toggleTheme}
        aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
      />
      <span className="bb8-toggle__container" aria-hidden="true">
        <span className="bb8-toggle__scenery"><i /><i /><i /><b /></span>
        <span className="bb8-toggle__bb8"><span className="bb8-toggle__head" /><span className="bb8-toggle__body" /></span>
        <span className="bb8-toggle__shadow" />
      </span>
    </label>
  );
}
