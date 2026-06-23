export default function CheckoutSection({
  grandTotal,
  showPayment, paymentInput, setPaymentInput,
  saving, checkoutError,
  change,
  onCheckoutStart, onCheckout,
}) {
  const payment = parseInt(paymentInput) || 0

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
      <div className="flex justify-between font-bold text-lg pt-2">
        <span>合計</span>
        <span>¥{grandTotal.toLocaleString()}</span>
      </div>

      {showPayment ? (
        <div className="mt-4">
          <label className="text-sm text-gray-600 mb-1 block">
            お預かり金額（現金）<span className="text-gray-400 font-normal ml-1">任意</span>
          </label>
          <input
            type="number"
            value={paymentInput}
            onChange={e => setPaymentInput(e.target.value)}
            className="w-full border-2 border-blue-400 rounded-lg px-4 py-3 text-xl text-right font-bold"
            placeholder="入力しない場合はそのまま会計完了"
          />
          {payment > 0 && (
            <div className={`mt-2 text-right text-lg font-bold ${change >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              お釣り: ¥{change.toLocaleString()}
            </div>
          )}
          <button
            onClick={onCheckout}
            disabled={saving}
            className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-4 text-lg transition-colors"
          >
            {saving ? '処理中...' : '会計完了'}
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={onCheckoutStart}
            className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-4 text-lg transition-colors"
          >
            会計へ進む
          </button>
          {checkoutError && (
            <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {checkoutError}
            </div>
          )}
        </>
      )}
    </div>
  )
}
