import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  MapPin,
  Plus,
  Trash2,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import {
  bookInterviewSlotAtomically,
  createInterviewSlot,
  deleteInterviewSlot,
  updateBookingStatus,
  updateInterviewSlot,
} from '../lib/apiService';
import {
  CandidateRecord,
  DEPARTMENTS,
  InterviewMode,
  InterviewSlot,
  StaffUser,
} from '../types/ats';

interface InterviewSchedulerViewProps {
  slots: InterviewSlot[];
  candidates: CandidateRecord[];
  staffUser: StaffUser;
  onRefresh: () => Promise<void> | void;
  onSelectCandidate: (candidate: CandidateRecord) => void;
  onNotify: (message: string) => void;
}

const INTERVIEW_MODES: InterviewMode[] = [
  'Google Meet',
  'Microsoft Teams',
  'On-site (KL HQ)',
  'On-site (Penang)',
];

export const InterviewSchedulerView: React.FC<InterviewSchedulerViewProps> = ({
  slots,
  candidates,
  staffUser,
  onRefresh,
  onSelectCandidate,
  onNotify,
}) => {
  const isAdmin = staffUser.role === 'administrator';
  const [date, setDate] = useState(() =>
    new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  );
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [capacity, setCapacity] = useState(2);
  const [interviewerName, setInterviewerName] = useState(staffUser.name);
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [mode, setMode] = useState<InterviewMode>('Google Meet');
  const [locationOrLink, setLocationOrLink] = useState('https://meet.google.com/tfmy-interview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Assign candidate state per slot
  const [assignMap, setAssignMap] = useState<Record<number, number | ''>>({});

  // Edit slot modal state
  const [editingSlot, setEditingSlot] = useState<InterviewSlot | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editCapacity, setEditCapacity] = useState(1);
  const [editLocation, setEditLocation] = useState('');
  const [editInterviewer, setEditInterviewer] = useState('');

  const qualifiedUnbooked = useMemo(
    () =>
      candidates.filter(
        (c) =>
          (c.qualification_status === 'qualified' || c.stage === 8 || c.stage === 9) &&
          !c.active_booking
      ),
    [candidates]
  );

  const stats = useMemo(() => {
    const activeSlots = slots.filter((s) => s.status === 'ACTIVE');
    const totalCapacity = activeSlots.reduce((sum, s) => sum + s.capacity, 0);
    const totalBooked = activeSlots.reduce((sum, s) => sum + s.booked_count, 0);
    const openSeats = Math.max(0, totalCapacity - totalBooked);
    return { activeCount: activeSlots.length, totalCapacity, totalBooked, openSeats };
  }, [slots]);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createInterviewSlot({
        date,
        start_time: startTime,
        end_time: endTime,
        capacity,
        location_or_link: locationOrLink,
        interviewer_name: interviewerName,
        department,
        mode,
      });
      await onRefresh();
      onNotify(`Published interview slot on ${date} (${startTime}–${endTime}, capacity ${capacity}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create interview slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleAssignCandidate = async (slotId: number) => {
    const candId = assignMap[slotId];
    if (!candId) return;
    setBusy(true);
    setError('');
    try {
      await bookInterviewSlotAtomically(slotId, Number(candId));
      setAssignMap((prev) => ({ ...prev, [slotId]: '' }));
      await onRefresh();
      onNotify('Interview slot reserved atomically and confirmation email dispatched.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCancelSlot = async (slot: InterviewSlot) => {
    setBusy(true);
    setError('');
    try {
      const nextStatus = slot.status === 'ACTIVE' ? 'CANCELLED' : 'ACTIVE';
      await updateInterviewSlot(slot.id, { status: nextStatus });
      await onRefresh();
      onNotify(`Interview slot ${nextStatus === 'CANCELLED' ? 'cancelled' : 're-activated'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSlot = async (slotId: number) => {
    setBusy(true);
    setError('');
    try {
      await deleteInterviewSlot(slotId);
      await onRefresh();
      onNotify('Deleted interview slot.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete slot.');
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (slot: InterviewSlot) => {
    setEditingSlot(slot);
    setEditDate(slot.date);
    setEditStart(slot.start_time);
    setEditEnd(slot.end_time);
    setEditCapacity(slot.capacity);
    setEditLocation(slot.location_or_link);
    setEditInterviewer(slot.interviewer_name);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlot) return;
    setBusy(true);
    setError('');
    try {
      await updateInterviewSlot(editingSlot.id, {
        date: editDate,
        start_time: editStart,
        end_time: editEnd,
        capacity: editCapacity,
        location_or_link: editLocation,
        interviewer_name: editInterviewer,
      });
      setEditingSlot(null);
      await onRefresh();
      onNotify('Updated interview slot schedule & capacity.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleBookingTransition = async (
    bookingId: number,
    status: 'COMPLETED' | 'RESCHEDULED' | 'CANCELLED'
  ) => {
    setBusy(true);
    setError('');
    try {
      await updateBookingStatus(bookingId, status);
      await onRefresh();
      onNotify(`Booking marked as ${status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update booking.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header summary strip */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Interview Calendar &amp; Atomic Slot Booking</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            SQLite transactions enforce capacity limits (`booked_count &lt; capacity`) so candidates never double-book a time slot.
          </p>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div>
            <div className="text-[#64748B]">Active Slots</div>
            <div className="font-mono text-lg font-bold text-[#0F172A] tabular-nums">{stats.activeCount}</div>
          </div>
          <div>
            <div className="text-[#64748B]">Booked Seats</div>
            <div className="font-mono text-lg font-bold text-[#0F766E] tabular-nums">
              {stats.totalBooked} / {stats.totalCapacity}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">Awaiting Booking</div>
            <div className="font-mono text-lg font-bold text-[#B45309] tabular-nums">
              {qualifiedUnbooked.length}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Create Interview Slot Form (Administrator Only) */}
      {isAdmin ? (
        <form
          onSubmit={handleCreateSlot}
          className="rounded-lg border border-[#E2E8F0] bg-white p-5 space-y-4"
        >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#0F172A]">Publish New Interview Slot</h2>
          <span className="text-[11px] font-mono text-[#64748B]">MYT (UTC+8)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">Interview Date</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">Start Time</label>
            <input
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">End Time</label>
            <input
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">
              Capacity Limit (Candidates)
            </label>
            <input
              type="number"
              required
              min={1}
              max={20}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))}
              className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs font-mono text-[#0F172A]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">Panelist / Interviewer</label>
            <input
              type="text"
              required
              value={interviewerName}
              onChange={(e) => setInterviewerName(e.target.value)}
              placeholder="Enter interviewer full name"
              className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">Interview Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as InterviewMode)}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
            >
              {INTERVIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">Meeting Link / Room</label>
            <input
              type="text"
              required
              value={locationOrLink}
              onChange={(e) => setLocationOrLink(e.target.value)}
              placeholder="Meet URL or KL HQ Room"
              className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Create Interview Slot
          </button>
        </div>
        </form>
      ) : (
        <div className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-xs text-[#475569]">
          <strong>Manager (View Only):</strong> You can inspect published interview slots, capacity counts, and booked candidates below. Slot creation, rescheduling, and cancellations require Administrator access.
        </div>
      )}

      {/* Slots List */}
      <div className="space-y-3">
        {slots.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-10 text-center text-xs text-[#64748B]">
            No interview slots configured yet. Publish a slot above so qualified candidates can book via their self-service portal.
          </div>
        ) : (
          slots.map((slot) => {
            const isFull = slot.booked_count >= slot.capacity;
            const remaining = Math.max(0, slot.capacity - slot.booked_count);
            const activeBookings = slot.bookings.filter((b) => b.status === 'CONFIRMED');

            return (
              <div
                key={slot.id}
                className={`rounded-lg border bg-white p-4 space-y-3 ${
                  slot.status === 'CANCELLED' ? 'border-[#E2E8F0] opacity-70' : 'border-[#E2E8F0]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5 text-sm font-bold text-[#0F172A]">
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <Calendar className="h-4 w-4 text-[#0F766E]" />
                        {slot.date}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[#334155]">
                        <Clock className="h-3.5 w-3.5 text-[#64748B]" />
                        {slot.start_time} – {slot.end_time}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          slot.status === 'CANCELLED'
                            ? 'text-[#DC2626]'
                            : isFull
                            ? 'text-[#B45309]'
                            : 'text-[#15803D]'
                        }`}
                      >
                        {slot.status === 'CANCELLED'
                          ? 'CANCELLED'
                          : isFull
                          ? 'FULL CAPACITY'
                          : `${remaining} OF ${slot.capacity} OPEN`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-[#475569]">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-[#64748B]" />
                        Panelist: <strong className="text-[#0F172A]">{slot.interviewer_name}</strong>
                      </span>
                      <span>{slot.department}</span>
                      <span className="inline-flex items-center gap-1">
                        {slot.mode.startsWith('On-site') ? (
                          <MapPin className="h-3.5 w-3.5 text-[#64748B]" />
                        ) : (
                          <Video className="h-3.5 w-3.5 text-[#64748B]" />
                        )}
                        {slot.mode} · <span className="font-mono text-[11px]">{slot.location_or_link}</span>
                      </span>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(slot)}
                        className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2.5 py-1 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC]"
                      >
                        <Edit3 className="h-3 w-3" />
                        Reschedule / Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleToggleCancelSlot(slot)}
                        className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2.5 py-1 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC]"
                      >
                        <XCircle className="h-3 w-3" />
                        {slot.status === 'ACTIVE' ? 'Cancel Slot' : 'Re-activate'}
                      </button>
                      {slot.booked_count === 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDeleteSlot(slot.id)}
                          className="rounded border border-[#FECACA] p-1 text-[#DC2626] hover:bg-[#FEF2F2]"
                          title="Delete empty slot"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Booked candidates table */}
                {slot.bookings.length > 0 && (
                  <div className="border-t border-[#F1F5F9] pt-2.5 space-y-1.5">
                    {slot.bookings.map((b) => {
                      const cand = candidates.find((c) => c.id === b.candidate_id);
                      return (
                        <div
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#F8FAFC] px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => cand && onSelectCandidate(cand)}
                              className="font-semibold text-[#0F766E] hover:underline"
                            >
                              {b.candidate_name || `Candidate #${b.candidate_id}`}
                            </button>
                            <span className="text-[#64748B]">{b.candidate_position}</span>
                            <span className="font-mono text-[11px] font-semibold text-[#334155]">
                              [{b.status}]
                            </span>
                          </div>
                          {isAdmin && b.status === 'CONFIRMED' && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleBookingTransition(b.id, 'COMPLETED')}
                                className="inline-flex items-center gap-1 font-semibold text-[#15803D] hover:underline"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Mark Conducted
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleBookingTransition(b.id, 'RESCHEDULED')}
                                className="font-medium text-[#B45309] hover:underline"
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleBookingTransition(b.id, 'CANCELLED')}
                                className="font-medium text-[#DC2626] hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick Assign Qualified Candidate (Administrator Only) */}
                {isAdmin && slot.status === 'ACTIVE' && !isFull && qualifiedUnbooked.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-2.5">
                    <select
                      value={assignMap[slot.id] ?? ''}
                      onChange={(e) =>
                        setAssignMap((prev) => ({
                          ...prev,
                          [slot.id]: e.target.value ? Number(e.target.value) : '',
                        }))
                      }
                      className="flex-1 min-w-[220px] rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A]"
                    >
                      <option value="">Assign a qualified candidate to this slot...</option>
                      {qualifiedUnbooked.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.candidate_code} · {c.full_name} ({c.position})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !assignMap[slot.id]}
                      onClick={() => handleAssignCandidate(slot.id)}
                      className="inline-flex items-center gap-1 rounded bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Book Atomically ({activeBookings.length}/{slot.capacity})
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit Slot Modal */}
      {editingSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <h3 className="text-sm font-bold text-[#0F172A]">Reschedule / Edit Interview Slot</h3>
              <button
                type="button"
                onClick={() => setEditingSlot(null)}
                className="text-[#64748B] hover:text-[#0F172A]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-[#334155] mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded border border-[#CBD5E1] px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">Start Time</label>
                <input
                  type="time"
                  required
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="w-full rounded border border-[#CBD5E1] px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">End Time</label>
                <input
                  type="time"
                  required
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                  className="w-full rounded border border-[#CBD5E1] px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">Capacity</label>
                <input
                  type="number"
                  required
                  min={Math.max(1, editingSlot.booked_count)}
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(Number(e.target.value))}
                  className="w-full rounded border border-[#CBD5E1] px-3 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">Panelist</label>
                <input
                  type="text"
                  required
                  value={editInterviewer}
                  onChange={(e) => setEditInterviewer(e.target.value)}
                  className="w-full rounded border border-[#CBD5E1] px-3 py-1.5 text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-[#334155] mb-1">Location / Meeting Link</label>
                <input
                  type="text"
                  required
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  className="w-full rounded border border-[#CBD5E1] px-3 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => setEditingSlot(null)}
                className="rounded border border-[#CBD5E1] px-3 py-1.5 text-xs font-medium text-[#475569]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-[#0F766E] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
