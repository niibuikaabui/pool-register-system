function MenuItemButton({ item, grandTotal, flashedItemId, onAddItem }) {
  const wouldGoNegative = item.category === 'discount' && grandTotal + item.price < 0
  return (
    <button
      key={item.id}
      onClick={() => onAddItem(item)}
      disabled={wouldGoNegative}
      title={wouldGoNegative ? '割引後の合計がマイナスになるため選択できません' : undefined}
      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
        wouldGoNegative
          ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
          : flashedItemId === item.id
            ? 'bg-green-400 text-white'
            : 'bg-gray-100 hover:bg-gray-200'
      }`}
    >
      {item.name}{' '}
      <span className={wouldGoNegative ? 'text-gray-300' : 'text-gray-500'}>¥{item.price}</span>
    </button>
  )
}

export default function MenuSection({
  drinks, alcohols, foods, discounts,
  grandTotal,
  menuSearch, setMenuSearch,
  openCategories, setOpenCategories,
  flashedItemId,
  onAddItem,
}) {
  const categories = [
    ['🥤 ソフト', drinks],
    ['🍺 アルコール', alcohols],
    ['🍔 フード', foods],
    ['🏷️ 割引', discounts],
  ]
  const filteredAll = [...drinks, ...alcohols, ...foods, ...discounts]

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      <h2 className="font-semibold text-gray-700 mb-3">ドリンク・フード</h2>
      <input
        type="text"
        value={menuSearch}
        onChange={e => setMenuSearch(e.target.value)}
        placeholder="メニューを検索..."
        className="w-full border rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-blue-400"
      />
      {menuSearch.trim() && filteredAll.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-3">「{menuSearch}」に一致するメニューはありません</p>
      ) : (
        categories.map(([label, items]) =>
          items.length > 0 && (
            <div key={label} className="mb-1">
              {menuSearch.trim() ? (
                <div className="flex flex-wrap gap-2 mb-2">
                  {items.map(item => (
                    <MenuItemButton key={item.id} item={item} grandTotal={grandTotal} flashedItemId={flashedItemId} onAddItem={onAddItem} />
                  ))}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setOpenCategories(prev => ({ ...prev, [label]: !prev[label] }))}
                    className="w-full flex items-center justify-between text-sm text-gray-600 font-medium py-2 hover:text-gray-800"
                  >
                    <span>{label} <span className="text-gray-400 font-normal">({items.length})</span></span>
                    <span className="text-gray-400">{openCategories[label] ? '▲' : '▼'}</span>
                  </button>
                  {openCategories[label] && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {items.map(item => (
                        <MenuItemButton key={item.id} item={item} grandTotal={grandTotal} flashedItemId={flashedItemId} onAddItem={onAddItem} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        )
      )}
    </div>
  )
}
