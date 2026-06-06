export default function TableMoveModal({ tables, currentTableId, onMove, onClose, description }) {
  const filtered = tables.filter(t =>
    t.id !== currentTableId && (t.table_number < 6 || t.table_number === 99)
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 mb-1">移動先の台を選択</h2>
        {description && <p className="text-xs text-gray-400 mb-4">{description}</p>}
        <div className="flex flex-col gap-2">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => onMove(t.id)}
              className="flex items-center justify-between px-4 py-3 rounded-xl border hover:bg-gray-50 text-left transition-colors"
            >
              <span className="font-medium">{t.table_number === 99 ? 'その他' : `#${t.table_number}台`}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'in_use' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {t.status === 'in_use' ? '使用中' : '空き'}
              </span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full text-gray-400 text-sm">キャンセル</button>
      </div>
    </div>
  )
}
