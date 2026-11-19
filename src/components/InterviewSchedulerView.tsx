import React, { useState } from 'react';
import { CalendarPlus, CheckCircle2, Lock } from 'lucide-react';
import {
  CandidateRecord,
  DEPARTMENTS,
  InterviewMode,
  InterviewSlot,
  StaffRole,
  StaffUser,
} from '../types/ats';
import {
  bookInterviewSlotAtomically,
  createInterviewSlot,
  markInterviewCompleted,
} from '../lib/firestoreService';

interface InterviewSchedulerViewProps {
  slots: InterviewSlot[];
  candidates: CandidateRecord[];
  actor: StaffUser;
  effectiveRole: StaffRole;
  onSelectCandidate: (c: CandidateRecord) => void;
  onNotify: (msg: string) => void;
}

const MODES: InterviewMode[] = [
  'Google Meet',
  'Microsoft Teams',
  'On-site (KL HQ)',
  'On-site (Penang)',
];

export const InterviewSchedulerView: React.FC<InterviewSchedulerViewProps> = ({
  slots,
  candidates,
  actor,
  effectiveRole,
  onSelectCandidate,
  onNotify,
}) => {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [interviewerName, setInterviewerName] = useState('');
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [mode, setMode] = useState<InterviewMode>('Google Meet');
  const [meetingLinkOrRoom, setMeetingLinkOrRoom] = useState('https://meet.google.com/tfm-panel-my');
  const [creating, setCreating] = useState(false);

  const [assigningSlotId, setAssigningSlotId] = useState<string | null>(null);
  const [assignCandidateId, setAssignCandidateId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const invitedCandidates = candidates.filter(
    (c) => (c.status === 'interview_invited' || c.qualificationDecision === 'qualified') && !c.interviewSlotId
  );

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interviewerName.trim()) {
      setError('Interviewer name is required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createInterviewSlot({
        actor: { ...actor, role: effectiveRole },
        date,
        startTime,
        endTime,
        interviewerName,
        department,
        mode,
        meetingLinkOrRoom,
      });
      setInterviewerName('');
      onNotify(`Published available interview slot on ${date} (${startTime}–${endTime}).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create slot.');
    } finally {
      setCreating(false);
    }
  };

  const handleAtomicAssign = async (slotId: string) => {
    const cand = candidates.find((c) => c.id === assignCandidateId);
    if (!cand) return;
    setError(null);
    try {
      await bookInterviewSlotAtomically({
        actor: { ...actor, role: effectiveRole },
        candidate: cand,
        slotId,
      });
      setAssigningSlotId(null);
      setAssignCandidateId('');
      onNotify(`Atomically reserved slot for ${cand.fullName} & dispatched confirmation email.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Atomic slot booking failed.');
    }
  };

  const handleMarkCompleted = async (slot: InterviewSlot) => {
    const cand = candidates.find((c) => c.id === slot.bookedCandidateId);
    if (!cand) return;
    setError(null);
    try {
      await markInterviewCompleted({
        actor: { ...actor, role: effectiveRole },
        candidate: cand,
        slotId: slot.id,
      });
      onNotify(`Interview with ${cand.fullName} marked completed (Stage 11). Ready for panel evaluation.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to mark interview completed.');
    }
  };

  const availableCount = slots.filter((s) => s.status === 'available').length;
  const bookedCount = slots.filter((s) => s.status === 'booked').length;
  const completedCount = slots.filter((s) => s.status === 'completed').length;

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {/* Summary Bar */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Available Slots</div>
          <div className="font-mono tabular-nums text-2xl font-semibold text-teal-700 mt-1">{availableCount}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Confirmed Bookings</div>
          <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 mt-1">{bookedCount}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Interviews Conducted</div>
          <div className="font-mono tabular-nums text-2xl font-semibold text-emerald-700 mt-1">{completedCount}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Awaiting Slot Selection</div>
          <div className="font-mono tabular-nums text-2xl font-semibold text-amber-700 mt-1">
            {invitedCandidates.length}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Publish New Slot Panel */}
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-1">
            <CalendarPlus className="w-4 h-4 text-teal-700" />
            <h3 className="font-display text-sm font-bold text-slate-900">
              Publish Available Slot
            </h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Open slots immediately appear in the Candidate Self-Service Interview Portal.
          </p>

          {effectiveRole === 'hiring_manager' ? (
            <div className="p-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Publishing interview slots is managed by HR Admin and Recruiters.</span>
            </div>
          ) : (
            <form onSubmit={handleAddSlot} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Interview Date</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Start (MYT)</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">End (MYT)</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Panelist / Interviewer</label>
                <input
                  type="text"
                  required
                  value={interviewerName}
                  onChange={(e) => setInterviewerName(e.target.value)}
                  placeholder="e.g. Puan Nurul Huda (VP Engineering)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Interview Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as InterviewMode)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Meeting Link or HQ Room</label>
                <input
                  type="text"
                  value={meetingLinkOrRoom}
                  onChange={(e) => setMeetingLinkOrRoom(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
              >
                {creating ? 'Publishing Slot...' : 'Add Available Interview Slot'}
              </button>
            </form>
          )}
        </section>

        {/* Master Interview Schedule Grid */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Stages 10–11 · Interview Schedule & Atomic Slot Ledger
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time Firestore transaction locking guarantees zero double-booking across candidates.
              </p>
            </div>
            <span className="font-mono tabular-nums text-xs text-slate-500">{slots.length} slots</span>
          </div>

          {slots.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No interview slots published yet. Use the form on the left to add open interview slots.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {slots.map((slot) => {
                const cand = candidates.find((c) => c.id === slot.bookedCandidateId);
                return (
                  <div key={slot.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {slot.date} · {slot.startTime}–{slot.endTime} MYT
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span
                          className={`font-semibold ${
                            slot.status === 'available'
                              ? 'text-teal-700'
                              : slot.status === 'booked'
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {slot.status === 'available'
                            ? 'Available'
                            : slot.status === 'booked'
                              ? 'Confirmed (Locked)'
                              : slot.status === 'completed'
                                ? 'Completed'
                                : 'Cancelled'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600">
                        {slot.interviewerName} · {slot.department} · {slot.mode}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate max-w-md">
                        {slot.meetingLinkOrRoom}
                      </div>
                      {slot.bookedCandidateName && (
                        <div className="text-xs text-slate-800 pt-0.5">
                          Candidate:{' '}
                          <button
                            type="button"
                            onClick={() => cand && onSelectCandidate(cand)}
                            className="font-semibold text-teal-700 hover:underline cursor-pointer"
                          >
                            {slot.bookedCandidateName}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0">
                      {slot.status === 'available' && effectiveRole !== 'hiring_manager' && (
                        assigningSlotId === slot.id ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={assignCandidateId}
                              onChange={(e) => setAssignCandidateId(e.target.value)}
                              className="px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                            >
                              <option value="">Select invited candidate...</option>
                              {invitedCandidates.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.fullName} ({c.positionApplied})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!assignCandidateId}
                              onClick={() => handleAtomicAssign(slot.id)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded cursor-pointer"
                            >
                              Lock
                            </button>
                            <button
                              type="button"
                              onClick={() => setAssigningSlotId(null)}
                              className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={invitedCandidates.length === 0}
                            onClick={() => {
                              setAssigningSlotId(slot.id);
                              setAssignCandidateId(invitedCandidates[0]?.id || '');
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            Assign Candidate
                          </button>
                        )
                      )}

                      {slot.status === 'booked' && cand && (
                        <button
                          type="button"
                          onClick={() => handleMarkCompleted(slot)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Mark Conducted</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
