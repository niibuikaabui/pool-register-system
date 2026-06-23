import { TYPE_LABEL } from '../../lib/constants'

export default function MemberSection({
  memberId, memberName,
  memberSearch, setMemberSearch,
  members, memberError,
  guestName, setGuestName,
  guestNameSaved,
  editingGuestName, setEditingGuestName,
  guestNameDraft, setGuestNameDraft,
  barcodeRef,
  onMemberSelect, onMemberRemove,
  onGuestNameSave, onGuestNameBlur,
  onBarcodeInput, onSearch,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      <h2 className="font-semibold text-gray-700 mb-3">お客様情報（任意）</h2>
      {memberId ? (
        <div className="flex items-center gap-3">
          <span className="text-green-700 font-medium">✓ {memberName || '会員選択済み'}</span>
          <button onClick={onMemberRemove} className="text-sm text-gray-400">解除</button>
        </div>
      ) : guestNameSaved && !editingGuestName ? (
        <div className="flex items-center gap-3">
          <span className="text-gray-700 font-medium">👤 {guestName}</span>
          <button
            onClick={() => { setGuestNameDraft(guestName); setEditingGuestName(true) }}
            className="text-sm text-gray-400"
          >変更</button>
        </div>
      ) : (
        <div>
          {editingGuestName ? (
            <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600 w-12 shrink-0">お名前</label>
                <input
                  value={guestNameDraft}
                  onChange={e => setGuestNameDraft(e.target.value)}
                  placeholder="例：田中さん"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditingGuestName(false)} className="text-xs text-gray-400 px-3 py-1 rounded border">キャンセル</button>
                <button onClick={onGuestNameSave} className="text-xs text-white bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded">保存</button>
              </div>
            </div>
          ) : (
            <div className="mb-3">
              <label className="text-sm text-gray-600 mb-1 block">お名前（非会員）</label>
              <input
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                onBlur={onGuestNameBlur}
                placeholder="例：田中さん"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}
          <div className="flex gap-2 mb-2">
            <input
              ref={barcodeRef}
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              onKeyDown={onBarcodeInput}
              placeholder="会員検索（名前・会員番号・電話番号）"
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={() => onSearch(memberSearch)} className="bg-gray-200 hover:bg-gray-300 px-3 rounded-lg text-sm">
              検索
            </button>
          </div>
          {memberError && <p className="text-sm text-red-500 mt-1">{memberError}</p>}
          {members.length > 0 && (
            <div className="border rounded-lg divide-y">
              {members.map(m => (
                <button
                  key={m.id}
                  onClick={() => onMemberSelect(m)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="text-gray-400 ml-2">#{m.member_number}</span>
                  <span className="text-gray-400 ml-2">{TYPE_LABEL[m.customer_type]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
