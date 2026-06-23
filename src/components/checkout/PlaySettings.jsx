import { TYPE_LABEL, PRICING_LABEL, isFreetime } from '../../lib/constants'
import { fmtTime, fmtElapsed } from '../../lib/utils'
import TimeBlockEditForm from './TimeBlockEditForm'

export default function PlaySettings({
  customerType, pricingType,
  activeBlock, editingBlockId,
  rate,
  editStartDate, setEditStartDate,
  editStartTime, setEditStartTime,
  onCustomerTypeChange, onPricingTypeChange,
  onStartBlock, onEndBlock,
  onOpenEdit, onSaveEdit, onCancelEdit,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      <h2 className="font-semibold text-gray-700 mb-3">プレー設定</h2>

      {/* 区分・種別 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-sm text-gray-600 mb-1 block">区分</label>
          <div className="flex gap-1">
            {['general', 'female', 'university', 'high_school', 'staff'].map(t => (
              <button
                key={t}
                onClick={() => onCustomerTypeChange(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                  customerType === t ? 'bg-green-700 text-white border-green-700' : 'border-gray-300 text-gray-700'
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-600 mb-1 block">種別</label>
          <div className="grid grid-cols-2 gap-1">
            {['hourly_multi', 'hourly_single', 'freetime_beer', 'freetime_no_beer'].map(v => {
              const disabledFreetime = isFreetime(v) && (customerType === 'high_school' || customerType === 'staff')
              const isDisabled = !!activeBlock || disabledFreetime
              return (
                <button
                  key={v}
                  onClick={() => { if (!isDisabled) onPricingTypeChange(v) }}
                  disabled={isDisabled}
                  title={disabledFreetime ? `${TYPE_LABEL[customerType]}はフリータイム不可` : undefined}
                  className={`py-2 rounded-lg text-xs font-medium border whitespace-nowrap ${
                    pricingType === v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'
                  } ${isDisabled ? 'opacity-30 cursor-not-allowed' : ''}`}
                >
                  {PRICING_LABEL[v]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 料金表示 */}
      {rate && (
        <p className="text-sm text-gray-500 mb-3">
          {!isFreetime(pricingType)
            ? `${PRICING_LABEL[pricingType]}: ${((rate.price_per_minute || 0) * 60).toLocaleString()}円/時`
            : `${PRICING_LABEL[pricingType]}: ${rate.freetime_price?.toLocaleString()}円`}
        </p>
      )}

      {/* 時間ブロック */}
      <div className="border-t pt-3 mt-1">
        {activeBlock ? (
          <div>
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <div className="text-sm">
                <span className="font-semibold text-green-800">▶ プレー中</span>
                <span className="text-gray-600 ml-3">{fmtTime(activeBlock.started_at)} 開始</span>
                {!isFreetime(pricingType) && (
                  <>
                    <span className="text-gray-500 ml-2">経過 {fmtElapsed(activeBlock.started_at, null)}</span>
                    <button
                      onClick={() => onOpenEdit(activeBlock)}
                      className="ml-3 text-xs text-blue-400 hover:text-blue-600 border border-blue-200 hover:border-blue-400 px-2 py-0.5 rounded transition-colors"
                    >
                      開始時刻を修正
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={() => onEndBlock(activeBlock.id)}
                className="bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
              >
                ■ 終了
              </button>
            </div>
            {editingBlockId === activeBlock.id && (
              <TimeBlockEditForm
                block={activeBlock}
                showEnd={false}
                editStartDate={editStartDate}
                setEditStartDate={setEditStartDate}
                editStartTime={editStartTime}
                setEditStartTime={setEditStartTime}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
              />
            )}
          </div>
        ) : (
          <button
            onClick={onStartBlock}
            className="w-full bg-green-700 hover:bg-green-600 text-white font-bold rounded-lg py-3 text-sm transition-colors"
          >
            ▶ ビリヤード開始
          </button>
        )}
      </div>
    </div>
  )
}
