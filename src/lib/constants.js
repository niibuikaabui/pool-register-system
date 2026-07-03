export const TYPE_LABEL = { general: '一般', female: '女性', university: '大学生', high_school: '高校生', staff: 'スタッフ' }

export const FREETIME_MINUTES = 120

export const PRICING_LABEL = {
  hourly_multi: '時間制（複数）',
  hourly_single: '時間制（一人）',
  freetime_beer: 'フリータイム（ビール有）',
  freetime_no_beer: 'フリータイム（ビール無）',
}

export function isFreetime(pricingType) {
  return pricingType === 'freetime_beer' || pricingType === 'freetime_no_beer'
}

export const CATEGORY_ICON = { drink: '🥤', alcohol: '🍺', food: '🍔', discount: '🏷️' }
export const CATEGORY_LABEL = { drink: 'ソフト', alcohol: 'アルコール', food: 'フード', discount: '割引' }
