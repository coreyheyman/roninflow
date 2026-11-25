// A Macro page's title. Switching pages happens in the category bar above (MacroNav).
import { macroPage } from './MacroNav';

export default function MacroSwitch({ current }) {
  return <h1 className="page-title macro-title">{macroPage(current)?.label || 'Macro'}</h1>;
}
