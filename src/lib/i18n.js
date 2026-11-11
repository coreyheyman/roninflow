// Interface translations. English is the source text; other languages replace whole phrases on screen.
// The translator (I18nDom in Layout) swaps matching text and placeholders as the app renders, so components
// stay in plain English. Phrases built from numbers ("3 trades") and your own content are left as they are.
// Add a phrase: put the English text as the key and the translations in LANG order (more languages: i18n-more.js).
import { MORE_LANGS, MORE_ORDER, MORE_PHRASES } from './i18n-more';

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'zh', label: '中文（简体）' },
  { code: 'ja', label: '日本語' },
  ...MORE_LANGS,
];
const ORDER = ['es', 'pt', 'de', 'fr', 'zh', 'ja'];

// English → [es, pt, de, fr, zh, ja]
const PHRASES = {
  // navigation & shell
  'Dashboard': ['Panel', 'Painel', 'Übersicht', 'Tableau de bord', '仪表盘', 'ダッシュボード'],
  'Trading Journal': ['Diario de trading', 'Diário de trading', 'Trading-Journal', 'Journal de trading', '交易日志', 'トレード日誌'],
  'Trading Coach': ['Coach de trading', 'Coach de trading', 'Trading-Coach', 'Coach de trading', '交易教练', 'トレードコーチ'],
  'Daily Diary': ['Diario diario', 'Diário diário', 'Tagebuch', 'Journal quotidien', '每日日记', 'デイリー日記'],
  'Review': ['Revisión', 'Revisão', 'Rückblick', 'Bilan', '复盘', 'レビュー'],
  'Strategy': ['Estrategia', 'Estratégia', 'Strategie', 'Stratégie', '策略', '戦略'],
  'Risk Management': ['Gestión del riesgo', 'Gestão de risco', 'Risikomanagement', 'Gestion du risque', '风险管理', 'リスク管理'],
  'Accounts': ['Cuentas', 'Contas', 'Konten', 'Comptes', '账户', '口座'],
  'Payouts': ['Retiros', 'Saques', 'Auszahlungen', 'Paiements', '出金', '出金'],
  'Connections': ['Conexiones', 'Conexões', 'Verbindungen', 'Connexions', '连接', '接続'],
  'Notifications': ['Notificaciones', 'Notificações', 'Benachrichtigungen', 'Notifications', '通知', '通知'],
  'Menu': ['Menú', 'Menu', 'Menü', 'Menu', '菜单', 'メニュー'],
  'Theme': ['Tema', 'Tema', 'Design', 'Thème', '主题', 'テーマ'],
  'Database': ['Base de datos', 'Banco de dados', 'Datenbank', 'Base de données', '数据库', 'データベース'],
  'Inbox': ['Bandeja', 'Caixa de entrada', 'Eingang', 'Boîte de réception', '收件箱', '受信箱'],
  'Weekly': ['Semanal', 'Semanal', 'Wöchentlich', 'Hebdomadaire', '每周', '週次'],
  'Monthly': ['Mensual', 'Mensal', 'Monatlich', 'Mensuel', '每月', '月次'],
  'Quarterly': ['Trimestral', 'Trimestral', 'Quartalsweise', 'Trimestriel', '每季度', '四半期'],
  'Yearly': ['Anual', 'Anual', 'Jährlich', 'Annuel', '每年', '年次'],
  // user menu
  'Appearance': ['Apariencia', 'Aparência', 'Darstellung', 'Apparence', '外观', '外観'],
  'Mask account numbers': ['Ocultar números de cuenta', 'Ocultar números de conta', 'Kontonummern verbergen', 'Masquer les numéros de compte', '隐藏账号', '口座番号を隠す'],
  'Currency': ['Moneda', 'Moeda', 'Währung', 'Devise', '货币', '通貨'],
  'Language': ['Idioma', 'Idioma', 'Sprache', 'Langue', '语言', '言語'],
  'Time zone': ['Zona horaria', 'Fuso horário', 'Zeitzone', 'Fuseau horaire', '时区', 'タイムゾーン'],
  'Phone & network access': ['Acceso desde el móvil y la red', 'Acesso pelo celular e rede', 'Handy- & Netzwerkzugriff', 'Accès mobile et réseau', '手机与网络访问', 'スマホとネットワーク'],
  'Coach settings': ['Ajustes del coach', 'Configurações do coach', 'Coach-Einstellungen', 'Réglages du coach', '教练设置', 'コーチ設定'],
  'Export backup (.json)': ['Exportar copia (.json)', 'Exportar backup (.json)', 'Sicherung exportieren (.json)', 'Exporter une sauvegarde (.json)', '导出备份 (.json)', 'バックアップを書き出す (.json)'],
  'Restore backup': ['Restaurar copia', 'Restaurar backup', 'Sicherung wiederherstellen', 'Restaurer une sauvegarde', '恢复备份', 'バックアップを復元'],
  'Security & privacy': ['Seguridad y privacidad', 'Segurança e privacidade', 'Sicherheit & Datenschutz', 'Sécurité et confidentialité', '安全与隐私', 'セキュリティとプライバシー'],
  'Price data': ['Datos de precios', 'Dados de preço', 'Kursdaten', 'Données de prix', '价格数据', '価格データ'],
  'Backups & updates': ['Copias y actualizaciones', 'Backups e atualizações', 'Sicherungen & Updates', 'Sauvegardes et mises à jour', '备份与更新', 'バックアップと更新'],
  'Sign out': ['Cerrar sesión', 'Sair', 'Abmelden', 'Se déconnecter', '退出登录', 'ログアウト'],
  // common actions
  'Save': ['Guardar', 'Salvar', 'Speichern', 'Enregistrer', '保存', '保存'],
  'Cancel': ['Cancelar', 'Cancelar', 'Abbrechen', 'Annuler', '取消', 'キャンセル'],
  'Close': ['Cerrar', 'Fechar', 'Schließen', 'Fermer', '关闭', '閉じる'],
  'Delete': ['Eliminar', 'Excluir', 'Löschen', 'Supprimer', '删除', '削除'],
  'Edit': ['Editar', 'Editar', 'Bearbeiten', 'Modifier', '编辑', '編集'],
  'Import': ['Importar', 'Importar', 'Importieren', 'Importer', '导入', 'インポート'],
  'Done': ['Listo', 'Concluído', 'Fertig', 'Terminé', '完成', '完了'],
  'Back': ['Atrás', 'Voltar', 'Zurück', 'Retour', '返回', '戻る'],
  'Continue': ['Continuar', 'Continuar', 'Weiter', 'Continuer', '继续', '続ける'],
  'Next': ['Siguiente', 'Próximo', 'Weiter', 'Suivant', '下一个', '次へ'],
  'Previous': ['Anterior', 'Anterior', 'Zurück', 'Précédent', '上一个', '前へ'],
  'Connect': ['Conectar', 'Conectar', 'Verbinden', 'Connecter', '连接', '接続'],
  'Disconnect': ['Desconectar', 'Desconectar', 'Trennen', 'Déconnecter', '断开', '切断'],
  'Check now': ['Comprobar ahora', 'Verificar agora', 'Jetzt prüfen', 'Vérifier', '立即检查', '今すぐ確認'],
  'Filters': ['Filtros', 'Filtros', 'Filter', 'Filtres', '筛选', 'フィルター'],
  'Today': ['Hoy', 'Hoje', 'Heute', "Aujourd'hui", '今天', '今日'],
  'Upcoming': ['Próximo', 'Próximo', 'Anstehend', 'À venir', '即将到来', '予定'],
  'All accounts': ['Todas las cuentas', 'Todas as contas', 'Alle Konten', 'Tous les comptes', '所有账户', 'すべての口座'],
  'Select date range': ['Elegir fechas', 'Selecionar período', 'Zeitraum wählen', 'Choisir une période', '选择日期范围', '期間を選択'],
  'Add payout': ['Añadir retiro', 'Adicionar saque', 'Auszahlung hinzufügen', 'Ajouter un paiement', '添加出金', '出金を追加'],
  'Add Strategy': ['Añadir estrategia', 'Adicionar estratégia', 'Strategie hinzufügen', 'Ajouter une stratégie', '添加策略', '戦略を追加'],
  'Set up': ['Configurar', 'Configurar', 'Einrichten', 'Configurer', '设置', '設定'],
  'Coming soon': ['Próximamente', 'Em breve', 'Demnächst', 'Bientôt', '即将推出', '近日公開'],
  'Connected': ['Conectado', 'Conectado', 'Verbunden', 'Connecté', '已连接', '接続済み'],
  'Not running': ['Sin actividad', 'Parado', 'Inaktiv', 'Inactif', '未运行', '停止中'],
  'Start Trading Session': ['Iniciar sesión de trading', 'Iniciar sessão de trading', 'Trading-Session starten', 'Démarrer la séance', '开始交易时段', 'トレードを開始'],
  "Open today's diary": ['Abrir el diario de hoy', 'Abrir o diário de hoje', 'Heutiges Tagebuch öffnen', "Ouvrir le journal du jour", '打开今日日记', '今日の日記を開く'],
  'Playbook': ['Playbook', 'Playbook', 'Playbook', 'Playbook', '交易手册', 'プレイブック'],
  'Edit questions': ['Editar preguntas', 'Editar perguntas', 'Fragen bearbeiten', 'Modifier les questions', '编辑问题', '質問を編集'],
  'Edit list': ['Editar lista', 'Editar lista', 'Liste bearbeiten', 'Modifier la liste', '编辑列表', 'リストを編集'],
  'Change source': ['Cambiar origen', 'Trocar origem', 'Quelle ändern', 'Changer de source', '更换来源', 'ソースを変更'],
  'Reset to defaults': ['Restablecer', 'Restaurar padrão', 'Zurücksetzen', 'Réinitialiser', '恢复默认', '初期設定に戻す'],
  'Check for new trades': ['Buscar operaciones nuevas', 'Buscar novas operações', 'Nach neuen Trades suchen', 'Chercher de nouveaux trades', '检查新交易', '新しいトレードを確認'],
  'Market conditions': ['Condiciones de mercado', 'Condições de mercado', 'Marktbedingungen', 'Conditions de marché', '市场状况', '相場環境'],
  'Trading strategies': ['Estrategias de trading', 'Estratégias de trading', 'Trading-Strategien', 'Stratégies de trading', '交易策略', 'トレード戦略'],
  'Edit market conditions': ['Editar condiciones de mercado', 'Editar condições de mercado', 'Marktbedingungen bearbeiten', 'Modifier les conditions de marché', '编辑市场状况', '相場環境を編集'],
  // metrics & tables
  'Net P&L': ['P&G neto', 'P&L líquido', 'Netto-G&V', 'P&L net', '净盈亏', '純損益'],
  'Win rate': ['Tasa de acierto', 'Taxa de acerto', 'Trefferquote', 'Taux de réussite', '胜率', '勝率'],
  'Win Rate': ['Tasa de acierto', 'Taxa de acerto', 'Trefferquote', 'Taux de réussite', '胜率', '勝率'],
  'Profit factor': ['Factor de beneficio', 'Fator de lucro', 'Profitfaktor', 'Facteur de profit', '盈利因子', 'プロフィットファクター'],
  'Profit Factor': ['Factor de beneficio', 'Fator de lucro', 'Profitfaktor', 'Facteur de profit', '盈利因子', 'プロフィットファクター'],
  'Trades': ['Operaciones', 'Operações', 'Trades', 'Trades', '交易', 'トレード'],
  'Avg hold': ['Tiempo medio', 'Tempo médio', 'Ø Haltedauer', 'Durée moy.', '平均持仓', '平均保有'],
  'Current risk': ['Riesgo actual', 'Risco atual', 'Aktuelles Risiko', 'Risque actuel', '当前风险', '現在のリスク'],
  'Today’s risk': ['Riesgo de hoy', 'Risco de hoje', 'Heutiges Risiko', 'Risque du jour', '今日风险', '今日のリスク'],
  'Edge Blockers': ['Bloqueos de ventaja', 'Bloqueios de vantagem', 'Edge-Blocker', 'Freins à l’edge', '优势阻碍', 'エッジブロッカー'],
  'Pre-session': ['Antes de la sesión', 'Pré-sessão', 'Vor der Session', 'Avant la séance', '盘前', 'セッション前'],
  'Post-session review': ['Revisión posterior', 'Revisão pós-sessão', 'Nachbereitung', 'Bilan de séance', '盘后复盘', 'セッション後レビュー'],
  'Journal notes': ['Notas del diario', 'Notas do diário', 'Tagebuchnotizen', 'Notes du journal', '日记笔记', '日記メモ'],
  'Chart screenshots': ['Capturas de gráficos', 'Capturas de gráficos', 'Chart-Screenshots', 'Captures de graphiques', '图表截图', 'チャート画像'],
  'Intraday P&L': ['P&G intradía', 'P&L intradiário', 'Intraday-G&V', 'P&L intrajournalier', '日内盈亏', '日中損益'],
  'P&L by trade': ['P&G por operación', 'P&L por operação', 'G&V je Trade', 'P&L par trade', '每笔盈亏', 'トレード別損益'],
  'Daily P&L': ['P&G diario', 'P&L diário', 'Tages-G&V', 'P&L quotidien', '每日盈亏', '日次損益'],
  'Calendar': ['Calendario', 'Calendário', 'Kalender', 'Calendrier', '日历', 'カレンダー'],
  'Symbols': ['Símbolos', 'Símbolos', 'Symbole', 'Symboles', '品种', '銘柄'],
  'Status': ['Estado', 'Status', 'Status', 'Statut', '状态', 'ステータス'],
  'Account': ['Cuenta', 'Conta', 'Konto', 'Compte', '账户', '口座'],
  'Notes': ['Notas', 'Notas', 'Notizen', 'Notes', '笔记', 'メモ'],
  'Date': ['Fecha', 'Data', 'Datum', 'Date', '日期', '日付'],
  'Time': ['Hora', 'Hora', 'Zeit', 'Heure', '时间', '時刻'],
  'Side': ['Lado', 'Lado', 'Richtung', 'Sens', '方向', '売買'],
  'Symbol': ['Símbolo', 'Símbolo', 'Symbol', 'Symbole', '品种', '銘柄'],
  'Tags': ['Etiquetas', 'Tags', 'Tags', 'Étiquettes', '标签', 'タグ'],
  'Long': ['Largo', 'Compra', 'Long', 'Long', '做多', 'ロング'],
  'Short': ['Corto', 'Venda', 'Short', 'Short', '做空', 'ショート'],
  'Drawdown': ['Drawdown', 'Drawdown', 'Drawdown', 'Drawdown', '回撤', 'ドローダウン'],
  'Total received': ['Total recibido', 'Total recebido', 'Erhalten gesamt', 'Total reçu', '累计收到', '受取合計'],
  'This year': ['Este año', 'Este ano', 'Dieses Jahr', 'Cette année', '今年', '今年'],
  'Average payout': ['Retiro medio', 'Saque médio', 'Ø Auszahlung', 'Paiement moyen', '平均出金', '平均出金額'],
  'Pending': ['Pendiente', 'Pendente', 'Ausstehend', 'En attente', '待处理', '保留中'],
  'Net after account costs': ['Neto tras costes de cuentas', 'Líquido após custos', 'Netto nach Kontokosten', 'Net après coûts des comptes', '扣除账户成本后净额', '口座費用控除後'],
  'Return on investment': ['Retorno de la inversión', 'Retorno sobre investimento', 'Rendite', 'Retour sur investissement', '投资回报率', '投資収益率'],
  'Account costs': ['Costes de cuentas', 'Custos das contas', 'Kontokosten', 'Coûts des comptes', '账户成本', '口座費用'],
  'No payouts yet': ['Aún no hay retiros', 'Nenhum saque ainda', 'Noch keine Auszahlungen', 'Aucun paiement pour l’instant', '暂无出金', '出金はまだありません'],
  // connections
  'Live sync': ['Sincronización en vivo', 'Sincronização ao vivo', 'Live-Sync', 'Synchro en direct', '实时同步', 'ライブ同期'],
  'Brokers & prop firms': ['Brókers y prop firms', 'Corretoras e mesas proprietárias', 'Broker & Prop-Firmen', 'Courtiers et prop firms', '券商与自营公司', 'ブローカーとプロップファーム'],
  'Crypto exchanges': ['Exchanges de cripto', 'Corretoras de cripto', 'Krypto-Börsen', 'Plateformes crypto', '加密货币交易所', '暗号資産取引所'],
  'Webhook / API': ['Webhook / API', 'Webhook / API', 'Webhook / API', 'Webhook / API', 'Webhook / API', 'Webhook / API'],
  'File import': ['Importar archivo', 'Importar arquivo', 'Datei-Import', 'Import de fichier', '文件导入', 'ファイル取込'],
  'Good to know': ['Conviene saber', 'Bom saber', 'Gut zu wissen', 'Bon à savoir', '须知', '知っておくこと'],
  'Sending trades': ['Enviando operaciones', 'Enviando operações', 'Sendet Trades', 'Envoi de trades', '正在发送交易', 'トレード送信中'],
  'Import trades': ['Importar operaciones', 'Importar operações', 'Trades importieren', 'Importer des trades', '导入交易', 'トレードを取り込む'],
  'Where are these trades from?': ['¿De dónde son estas operaciones?', 'De onde são estas operações?', 'Woher stammen diese Trades?', 'D’où viennent ces trades ?', '这些交易来自哪里？', 'どこのトレードですか？'],
  // diary
  'Ready to start trading?': ['¿Listo para operar?', 'Pronto para operar?', 'Bereit zum Traden?', 'Prêt à trader ?', '准备好交易了吗？', 'トレードの準備はできましたか？'],
  'Session check-in complete': ['Check-in de la sesión completado', 'Check-in da sessão concluído', 'Session-Check-in erledigt', 'Préparation de séance terminée', '时段准备已完成', 'セッション前チェック完了'],
  'Answer a few questions and get on track': ['Responde unas preguntas y céntrate', 'Responda algumas perguntas e entre no foco', 'Beantworte ein paar Fragen und leg los', 'Réponds à quelques questions et concentre-toi', '回答几个问题，进入状态', 'いくつか答えて準備を整えましょう'],
  'Mood after': ['Ánimo después', 'Humor depois', 'Stimmung danach', 'Humeur après', '交易后心情', '終了後の気分'],
  'Execution': ['Ejecución', 'Execução', 'Ausführung', 'Exécution', '执行', '執行'],
  'What will I do better tomorrow?': ['¿Qué haré mejor mañana?', 'O que vou fazer melhor amanhã?', 'Was mache ich morgen besser?', 'Que ferai-je mieux demain ?', '明天我要在哪方面做得更好？', '明日は何をもっと良くする？'],
  'How are you feeling?': ['¿Cómo te sientes?', 'Como você está?', 'Wie fühlst du dich?', 'Comment te sens-tu ?', '你感觉如何？', '気分はどうですか？'],
  'Sleep': ['Sueño', 'Sono', 'Schlaf', 'Sommeil', '睡眠', '睡眠'],
  'Focus': ['Enfoque', 'Foco', 'Fokus', 'Concentration', '专注', '集中'],
  'All sessions': ['Todas las sesiones', 'Todas as sessões', 'Alle Sessions', 'Toutes les séances', '所有交易日', 'すべてのセッション'],
  'Grid': ['Cuadrícula', 'Grade', 'Raster', 'Grille', '网格', 'グリッド'],
  'List': ['Lista', 'Lista', 'Liste', 'Liste', '列表', 'リスト'],
  // reviews
  'Weekly Review': ['Revisión semanal', 'Revisão semanal', 'Wochenrückblick', 'Bilan hebdomadaire', '周复盘', '週次レビュー'],
  'Monthly Review': ['Revisión mensual', 'Revisão mensal', 'Monatsrückblick', 'Bilan mensuel', '月复盘', '月次レビュー'],
  'Quarterly Review': ['Revisión trimestral', 'Revisão trimestral', 'Quartalsrückblick', 'Bilan trimestriel', '季度复盘', '四半期レビュー'],
  'Yearly Review': ['Revisión anual', 'Revisão anual', 'Jahresrückblick', 'Bilan annuel', '年度复盘', '年次レビュー'],
  'Write your review…': ['Escribe tu revisión…', 'Escreva sua revisão…', 'Schreib deinen Rückblick…', 'Écris ton bilan…', '写下你的复盘…', 'レビューを書く…'],
  // setup & security
  'Welcome to RoninFlow': ['Bienvenido a RoninFlow', 'Bem-vindo ao RoninFlow', 'Willkommen bei RoninFlow', 'Bienvenue dans RoninFlow', '欢迎使用 RoninFlow', 'RoninFlow へようこそ'],
  'Password': ['Contraseña', 'Senha', 'Passwort', 'Mot de passe', '密码', 'パスワード'],
  'Sign in': ['Iniciar sesión', 'Entrar', 'Anmelden', 'Se connecter', '登录', 'サインイン'],
  'Your name': ['Tu nombre', 'Seu nome', 'Dein Name', 'Ton nom', '你的名字', 'お名前'],
  'Skip': ['Omitir', 'Pular', 'Überspringen', 'Passer', '跳过', 'スキップ'],
  'Finish setup': ['Terminar configuración', 'Concluir configuração', 'Einrichtung abschließen', 'Terminer la configuration', '完成设置', '設定を完了'],
};

let lang = 'en';
const table = {};
for (const [en, arr] of Object.entries(PHRASES)) ORDER.forEach((code, i) => { (table[code] ||= new Map()).set(en, arr[i]); });
for (const [en, arr] of Object.entries(MORE_PHRASES)) MORE_ORDER.forEach((code, i) => { (table[code] ||= new Map()).set(en, arr[i]); });

export const getLang = () => lang;
/** Translate one English phrase (returns it unchanged when there is no translation). */
export function t(text) {
  if (lang === 'en' || text == null) return text;
  return table[lang]?.get(String(text)) ?? text;
}

// ---------------------------------------------------------------- live DOM translation
const seen = new WeakMap(); // text node → { en, shown }: the English text and what we last put on screen
const seenAttr = new WeakMap(); // element → { [attr]: { en, shown } }
const SKIP = 'input, textarea, select, [contenteditable], .no-i18n, code, pre';

const swap = (en) => {
  const key = en.trim();
  const tr = lang === 'en' ? null : table[lang]?.get(key);
  return tr ? en.replace(key, tr) : en;
};

function translateText(node) {
  const el = node.parentElement;
  if (!el || el.closest(SKIP)) return;
  const raw = node.nodeValue;
  if (!raw || !raw.trim()) return;
  const rec = seen.get(node);
  // if the node still shows what we wrote, its English is what we stored; otherwise React wrote new English text
  const en = rec && raw === rec.shown ? rec.en : raw;
  const next = swap(en);
  seen.set(node, { en, shown: next });
  if (next !== raw) node.nodeValue = next;
}

function translateAttrs(el) {
  if (!(el instanceof Element) || el.closest('.no-i18n')) return;
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    const store = seenAttr.get(el) || {};
    const en = store[attr] && v === store[attr].shown ? store[attr].en : v;
    const next = swap(en);
    store[attr] = { en, shown: next }; seenAttr.set(el, store);
    if (next !== v) el.setAttribute(attr, next);
  }
}

function walk(root) {
  if (root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1) return;
  translateAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = it.nextNode();
  while (n) { if (n.nodeType === 3) translateText(n); else translateAttrs(n); n = it.nextNode(); }
}

let observer = null;
/** Switch the interface language (call with 'en' to go back to English). */
export function setLanguage(code) {
  const next = LANGS.some((l) => l.code === code) ? code : 'en';
  if (next === lang && observer) return;
  lang = next;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((muts) => {
      if (lang === 'en' && !muts.length) return;
      observer.disconnect();
      for (const m of muts) {
        if (m.type === 'characterData') translateText(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
      observer.observe(document.body, OPTS);
    });
  }
  observer.disconnect();
  walk(document.body);
  observer.observe(document.body, OPTS);
}
const OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] };

/** Best guess from the browser for a first-time user. */
export const browserLang = () => {
  const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGS.some((x) => x.code === l) ? l : 'en';
};
