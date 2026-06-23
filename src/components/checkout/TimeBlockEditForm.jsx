export default function TimeBlockEditForm({
  block, showEnd,
  editStartDate, setEditStartDate,
  editStartTime, setEditStartTime,
  editEndDate, setEditEndDate,
  editEndTime, setEditEndTime,
  onSave, onCancel,
}) {
  return (
    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600 w-12 shrink-0">開始</label>
        <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <input type="time" value={editStartTime} onChange={e => setEditStartTime(e.target.value)} className="border rounded px-2 py-1 text-sm w-24" />
      </div>
      {showEnd && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 w-12 shrink-0">終了</label>
          <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <input type="time" value={editEndTime} onChange={e => setEditEndTime(e.target.value)} className="border rounded px-2 py-1 text-sm w-24" />
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-gray-400 px-3 py-1 rounded border">キャンセル</button>
        <button onClick={() => onSave(block)} className="text-xs text-white bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded">保存</button>
      </div>
    </div>
  )
}
