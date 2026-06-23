import { CATEGORY_ICON, isFreetime } from '../../lib/constants'
import { fmtTime, fmtElapsed } from '../../lib/utils'
import TimeBlockEditForm from './TimeBlockEditForm'

export default function OrderHistory({
  history, pricingType,
  editingBlockId,
  editStartDate, setEditStartDate,
  editStartTime, setEditStartTime,
  editEndDate, setEditEndDate,
  editEndTime, setEditEndTime,
  onEditBlock, onCancelOrder,
  onSaveEdit, onCancelEdit,
}) {
  if (history.length === 0) return null

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      <h2 className="font-semibold text-gray-700 mb-3">注文履歴</h2>
      <div className="flex flex-col gap-2">
        {history.map((item, i) => (
          <div key={`${item.id}-${i}`} className={`text-sm ${item.cancelled ? 'opacity-40' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-gray-400 text-xs shrink-0">{fmtTime(item.sortTime)}</span>
                {item.type === 'block' ? (
                  <span className="text-gray-700">
                    🎱 {fmtTime(item.startTime)}〜{item.endTime ? fmtTime(item.endTime) : <span className="text-green-600 font-medium">プレー中</span>}
                    <span className="text-gray-400 ml-1">({fmtElapsed(item.startTime, item.endTime)})</span>
                  </span>
                ) : (
                  <span className={`text-gray-700 ${item.cancelled ? 'line-through' : ''}`}>
                    {CATEGORY_ICON[item.category] ?? '🍹'} {item.name} ×{item.quantity}
                  </span>
                )}
                {item.cancelled && (
                  <span className="text-xs text-red-400 font-medium">キャンセル</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {item.type === 'block' && !item.isActive && editingBlockId !== item.id && (
                  <button
                    onClick={() => onEditBlock({ id: item.id, started_at: item.startTime, ended_at: item.endTime })}
                    className="text-xs text-blue-400 hover:text-blue-600 border border-blue-200 hover:border-blue-400 px-2 py-0.5 rounded transition-colors"
                  >
                    修正
                  </button>
                )}
                {item.type === 'order' && !item.cancelled && item.dbId && (
                  <button
                    onClick={() => onCancelOrder(item.dbId)}
                    className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-0.5 rounded transition-colors"
                  >
                    取消
                  </button>
                )}
                {item.type === 'block' && (item.isActive ? isFreetime(pricingType) : item.isLockedFreetime) ? (
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">フリータイム</span>
                ) : (
                  <span className={`font-medium text-right ${item.cancelled ? 'text-gray-400 line-through' : item.isActive ? 'text-orange-500' : 'text-gray-600'}`}>
                    {item.isActive && <span className="text-xs mr-1">概算</span>}
                    ¥{item.fee.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            {item.type === 'block' && !item.isActive && editingBlockId === item.id && (
              <TimeBlockEditForm
                block={{ id: item.id, started_at: item.startTime, ended_at: item.endTime }}
                showEnd={!!item.endTime}
                editStartDate={editStartDate}
                setEditStartDate={setEditStartDate}
                editStartTime={editStartTime}
                setEditStartTime={setEditStartTime}
                editEndDate={editEndDate}
                setEditEndDate={setEditEndDate}
                editEndTime={editEndTime}
                setEditEndTime={setEditEndTime}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
