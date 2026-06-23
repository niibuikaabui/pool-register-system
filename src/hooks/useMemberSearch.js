import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useMemberSearch(sessionId, { onCustomerTypeChange } = {}) {
  const [memberId, setMemberId] = useState(null)
  const [memberName, setMemberName] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [memberError, setMemberError] = useState('')
  const [members, setMembers] = useState([])
  const [guestName, setGuestName] = useState('')
  const [guestNameSaved, setGuestNameSaved] = useState(false)
  const [editingGuestName, setEditingGuestName] = useState(false)
  const [guestNameDraft, setGuestNameDraft] = useState('')
  const barcodeRef = useRef(null)

  useEffect(() => {
    if (!memberSearch) { setMembers([]); setMemberError(''); return }
    const t = setTimeout(() => searchMember(memberSearch), 300)
    return () => clearTimeout(t)
  }, [memberSearch])

  async function searchMember(query) {
    if (!query) { setMembers([]); return }
    setMemberError('')
    const numVal = parseInt(query)
    const filters = [`name.ilike.%${query}%`, `phone.ilike.%${query}%`]
    if (!isNaN(numVal)) filters.push(`member_number.eq.${numVal}`)
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .or(filters.join(','))
      .limit(5)
    if (error) { setMemberError('検索エラー: ' + error.message); return }
    setMembers(data || [])
    if (data?.length === 0) setMemberError('該当する会員が見つかりません')
  }

  function handleBarcodeInput(e) {
    if (e.key === 'Enter') searchMember(memberSearch)
  }

  async function handleMemberRemove() {
    setMemberId(null)
    setMemberName('')
    setMemberSearch('')
    await supabase.from('sessions').update({ member_id: null }).eq('id', sessionId)
  }

  async function handleMemberSelect(m) {
    setMemberId(m.id)
    setMemberName(m.name)
    setMemberSearch('')
    setMembers([])
    setMemberError('')
    await supabase.from('sessions').update({ member_id: m.id, customer_type: m.customer_type }).eq('id', sessionId)
    onCustomerTypeChange?.(m.customer_type)
  }

  async function handleGuestNameSave() {
    setGuestName(guestNameDraft)
    setGuestNameSaved(true)
    setEditingGuestName(false)
    await supabase.from('sessions').update({ guest_name: guestNameDraft.trim() || null }).eq('id', sessionId)
  }

  async function handleGuestNameBlur(e) {
    const name = e.target.value.trim()
    if (name) setGuestNameSaved(true)
    await supabase.from('sessions').update({ guest_name: name || null }).eq('id', sessionId)
  }

  // セッション読み込み後に会員・ゲスト名を初期化する
  function initFromSession(s) {
    if (s.member_id) setMemberId(s.member_id)
    if (s.members?.name) setMemberName(s.members.name)
    if (s.guest_name) { setGuestName(s.guest_name); setGuestNameSaved(true) }
  }

  return {
    memberId, memberName,
    memberSearch, setMemberSearch,
    members, memberError,
    guestName, setGuestName,
    guestNameSaved,
    editingGuestName, setEditingGuestName,
    guestNameDraft, setGuestNameDraft,
    barcodeRef,
    handleMemberRemove, handleMemberSelect,
    handleGuestNameSave, handleGuestNameBlur,
    handleBarcodeInput,
    onSearch: searchMember,
    initFromSession,
  }
}
