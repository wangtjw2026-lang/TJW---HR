import React, { useMemo } from 'react';
import { Download, RotateCcw, Search, Lock } from 'lucide-react';
import {
  CandidateFilters,
  CandidateRecord,
  DEPARTMENTS,
  OfferStatus,
  POSITIONS,
  ROLE_META,
  StaffRole,
  STATUS_META,
  WORKFLOW_STAGES,
} from '../types/ats';
import { filterCandidates, getStageTitle } from '../lib/atsHelpers';

interface CandidateTableViewProps {
  candidates: CandidateRecord[];
  filters: CandidateFilters;
  onChangeFilters: (next: CandidateFilters) => void;
  onResetFilters: () => void;
  onSelectCandidate: (candidate: CandidateRecord) => void;
  onExportCsv: (filtered: CandidateRecord[]) => Promise<void>;
  exportingCsv: boolean;
  effectiveRole: StaffRole;
}

const TONE_CLASS: Record<'neutral' | 'teal' | 'amber' | 'green' | 'red', string> = {
  neutral: 'text-slate-600',
  teal: 'text-teal-700',
  amber: 'text-amber-700',
  green: 'text-emerald-700',
  red: 'text-red-700',
};

export const CandidateTableView: React.FC<CandidateTableViewProps> = ({
  candidates,
  filters,
  onChangeFilters,
  onResetFilters,
  onSelectCandidate,
  onExportCsv,
  exportingCsv,
  effectiveRole,
}) => {
  const filtered = useMemo(() => filterCandidates(candidates, filters), [candidates, filters]);

  const dynamicPositions = useMemo(() => {
    const set = new Set<string>([...POSITIONS, ...candidates.map((c) => c.positionApplied)]);
    return Array.from(set).sort();
  }, [candidates]);

  const dynamicDepartments = useMemo(() => {
    const set = new Set<string>([...DEPARTMENTS, ...candidates.map((c) => c.department)]);
    return Array.from(set).sort();
  }, [candidates]);

  const canExport = ROLE_META[effectiveRole].canExportCsv;

  return (
    <div className="space-y-4">
      {/* 8-Dimension Filter Bar + Excel CSV Export */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onChangeFilters({ ...filters, search: e.target.value })}
              placeholder="Search name, code, skill, or role..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
            />
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>

            {canExport ? (
              <button
                type="button"
                disabled={exportingCsv || filtered.length === 0}
                onClick={() => onExportCsv(filtered)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exportingCsv ? 'Exporting...' : `Export Excel CSV (${filtered.length})`}</span>
              </button>
            ) : (
              <div
                title="Excel/CSV exports containing candidate PII & MYR salaries require HR Admin role per PDPA policy."
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>CSV Export · HR Admin Only</span>
              </div>
            )}
          </div>
        </div>

        {/* All 8 Required Filter Controls */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">App Date From</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onChangeFilters({ ...filters, dateFrom: e.target.value })}
              className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">App Date To</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => onChangeFilters({ ...filters, dateTo: e.target.value })}
              className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Position</label>
            <select
              value={filters.position}
              onChange={(e) => onChangeFilters({ ...filters, position: e.target.value })}
              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            >
              <option value="">All Positions</option>
              {dynamicPositions.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Department</label>
            <select
              value={filters.department}
              onChange={(e) => onChangeFilters({ ...filters, department: e.target.value })}
              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            >
              <option value="">All Departments</option>
              {dynamicDepartments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Source</label>
            <select
              value={filters.source}
              onChange={(e) =>
                onChangeFilters({ ...filters, source: e.target.value as CandidateFilters['source'] })
              }
              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            >
              <option value="">All Sources</option>
              <option value="JobStreet">JobStreet</option>
              <option value="Email">Email</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Stage (1–15)</label>
            <select
              value={filters.stage}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  stage: e.target.value === '' ? '' : Number(e.target.value),
                })
              }
              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            >
              <option value="">All Stages</option>
              {WORKFLOW_STAGES.map((s) => (
                <option key={s.stage} value={s.stage}>
                  {String(s.stage).padStart(2, '0')} · {s.shortTitle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Interview Date</label>
            <input
              type="date"
              value={filters.interviewDate}
              onChange={(e) => onChangeFilters({ ...filters, interviewDate: e.target.value })}
              className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Offer Status</label>
            <select
              value={filters.offerStatus}
              onChange={(e) =>
                onChangeFilters({ ...filters, offerStatus: e.target.value as '' | OfferStatus })
              }
              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
            >
              <option value="">All Offers</option>
              <option value="offer_sent">Offer Sent</option>
              <option value="pending_response">Pending Response</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
              <option value="none">No Offer Yet</option>
            </select>
          </div>
        </div>
      </section>

      {/* High-Density Candidate Data Grid */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong className="font-mono tabular-nums text-slate-900">{filtered.length}</strong> of{' '}
            <span className="font-mono tabular-nums">{candidates.length}</span> candidates
          </span>
          <span>
            Active PDPA Visibility: <strong className="text-slate-700">{ROLE_META[effectiveRole].label}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-4 whitespace-nowrap">Candidate</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Position & Department</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Source · Applied</th>
                <th className="py-2.5 px-4 whitespace-nowrap text-right">AI Fit</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Stage Milestone</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Interview / Offer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                    No candidates match the active filter criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const statusInfo = STATUS_META[c.status];
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectCandidate(c)}
                      className="hover:bg-slate-50/90 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4 align-middle">
                        <div className="font-semibold text-slate-900 text-[13px]">{c.fullName}</div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                          {c.candidateCode} · {c.maskedEmail}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-middle">
                        <div className="font-medium text-slate-800">{c.positionApplied}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{c.department}</div>
                      </td>
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        <div className="text-slate-700 font-medium">{c.source}</div>
                        <div className="font-mono tabular-nums text-[11px] text-slate-500 mt-0.5">
                          {c.applicationDate}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-middle text-right whitespace-nowrap">
                        <span
                          className={`font-mono tabular-nums font-semibold ${
                            c.aiMatchScore >= 85
                              ? 'text-emerald-700'
                              : c.aiMatchScore >= 70
                                ? 'text-teal-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {c.aiMatchScore}%
                        </span>
                      </td>
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        <span className="font-mono tabular-nums text-slate-500 mr-1.5">
                          S{String(c.currentStage).padStart(2, '0')}
                        </span>
                        <span className="font-medium text-slate-800">{getStageTitle(c.currentStage)}</span>
                      </td>
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        <span className={`font-medium ${TONE_CLASS[statusInfo.tone]}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 align-middle whitespace-nowrap text-slate-600">
                        {c.offerStatus !== 'none' ? (
                          <span className="font-medium text-slate-800">
                            Offer: {c.offerStatus.replace('_', ' ')}
                          </span>
                        ) : c.interviewDate ? (
                          <span className="font-mono tabular-nums">
                            {c.interviewDate} · {c.interviewTime}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
