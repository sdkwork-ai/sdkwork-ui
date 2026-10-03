import * as React from 'react';
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { mergeSlotProps } from '../../../lib/slot-props';
import { cn } from '../../../lib/utils';
import { EmptyState, LoadingBlock } from '../../patterns/feedback';
import { BulkActionBar } from '../actions';
import { Checkbox } from '../checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../table';
import { DataTableHeaderCell } from './data-table/header-cell';
import { DataTablePaginationControls } from './data-table/pagination-controls';
import {
  areSortingStatesEqual,
  clampPage,
  normalizePageSize,
  normalizeSortingState,
  resolvePageSizeOptions,
  resolvePaginationItems,
  toPublicSortingState,
} from './data-table/state';
import {
  dataTableFooterClassName,
  dataTableSummaryClassName,
  dataTableSurfaceClassName,
} from './data-table/styles';
import type {
  DataTableAccessorResolver,
  DataTableAlign,
  DataTableCellProps,
  DataTableColumn,
  DataTableDensity,
  DataTableProps as DataTablePropsContract,
  DataTableRegionSlotProps,
  DataTableRowProps,
} from './data-table/types';

export type {
  DataTableAccessorResolver,
  DataTableAlign,
  DataTableCellPropsResolver,
  DataTableCellProps,
  DataTableCellRenderer,
  DataTableColumn,
  DataTableDensity,
  DataTableExpandedRowRenderer,
  DataTableHeaderProps,
  DataTablePageChangeHandler,
  DataTablePageSizeChangeHandler,
  DataTablePaginationMode,
  DataTablePaginationProps,
  DataTableRegionSlotProps,
  DataTableRowActionsRenderer,
  DataTableRowClickHandler,
  DataTableRowExpandLabelResolver,
  DataTableRowIdResolver,
  DataTableRowProps,
  DataTableRowPropsResolver,
  DataTableRowSelectionLabelResolver,
  DataTableSelectedRowIdsChangeHandler,
  DataTableSlotProps,
  DataTableSortingChangeHandler,
  DataTableSortingMode,
  DataTableSortingState,
  DataTableSortingStateItem,
  DataTableTableSlotProps,
} from './data-table/types';

export interface DataTableProps<T = any> extends DataTablePropsContract<T> {}

const densityClassName: Record<DataTableDensity, string> = {
  comfortable: 'p-4',
  compact: 'px-4 py-2.5',
};

const alignClassName: Record<DataTableAlign, string> = {
  center: 'text-center',
  left: 'text-left',
  right: 'text-right',
};

function defaultGetRowId<T>(row: T, index: number) {
  return (row as { id?: React.Key }).id ?? index;
}

function resolveColumnAccessor<T>(column: DataTableColumn<T>): DataTableAccessorResolver<T> {
  if (column.accessorFn) {
    return column.accessorFn;
  }

  if (column.accessorKey) {
    return (row: T) => row[column.accessorKey as keyof T];
  }

  return (row: T) => (row as Record<string, unknown>)[column.id];
}

function normalizeColumnVisibility(columnVisibility?: Partial<Record<string, boolean>>) {
  return Object.fromEntries(
    Object.entries(columnVisibility ?? {}).filter((entry): entry is [string, boolean] => entry[1] !== undefined),
  );
}

function appendUniqueKeys(existing: React.Key[], additions: readonly React.Key[]) {
  const seen = new Set(existing.map((item) => String(item)));
  const next = [...existing];

  additions.forEach((item) => {
    const normalizedItem = String(item);

    if (!seen.has(normalizedItem)) {
      seen.add(normalizedItem);
      next.push(item);
    }
  });

  return next;
}

type DataTableComponent = React.ForwardRefExoticComponent<DataTableProps & React.RefAttributes<HTMLDivElement>> & {
  <T = any>(props: DataTableProps<T> & React.RefAttributes<HTMLDivElement>): React.ReactNode;
};

const DataTable: DataTableComponent = React.forwardRef<HTMLDivElement, DataTableProps>(({
  className,
  columnVisibility,
  columns,
  defaultSorting,
  density = 'comfortable',
  description,
  emptyDescription,
  emptyState,
  emptyTitle = 'No rows',
  footer,
  getRowId = defaultGetRowId,
  getRowExpandLabel,
  getRowProps,
  getRowSelectionLabel,
  loading = false,
  loadingLabel,
  onRowClick,
  onSelectedRowIdsChange,
  onSortingChange,
  pagination,
  renderExpandedRow,
  rowActions,
  rowActionsLabel = 'Actions',
  rowDetailLabel,
  rows,
  selectable = false,
  selectedRowIds = [],
  selectionBar,
  slotProps,
  sorting: controlledSorting,
  sortingMode = 'client',
  stickyHeader = false,
  title,
  toolbar,
  ...props
}, ref) => {
  const [uncontrolledPage, setUncontrolledPage] = React.useState(pagination?.defaultPage ?? 1);
  const [uncontrolledPageSize, setUncontrolledPageSize] = React.useState(
    normalizePageSize(pagination?.defaultPageSize ?? 10),
  );
  const [uncontrolledSorting, setUncontrolledSorting] = React.useState(() => normalizeSortingState(defaultSorting));
  /**
   * Row expansion. One row open at a time: the expanded panel is a detail
   * view of a master list, so opening a second row collapses the first. The
   * expansion is uncontrolled — a caller that needs controlled state already
   * owns the rows and can remount via `getRowId` changes.
   */
  const [expandedRowId, setExpandedRowId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (expandedRowId !== null && !renderExpandedRow) {
      setExpandedRowId(null);
    }
  }, [expandedRowId, renderExpandedRow]);

  const resolvedPageSize = normalizePageSize(pagination?.pageSize ?? uncontrolledPageSize);
  const totalRowCount = pagination?.mode === 'server'
    ? pagination.rowCount ?? rows.length
    : rows.length;
  /**
   * Keyset (cursor) server pagination: the backend has no total, so the page
   * count is unknown and Next is driven by `pagination.hasMore` rather than by
   * `Math.ceil(totalRowCount / pageSize)`. `pageCount` stays `undefined` in
   * that mode so no caller can accidentally render an invented page count.
   */
  const cursorPagination = pagination?.mode === 'server' && pagination.hasMore !== undefined;
  const pageCount = pagination && !cursorPagination
    ? Math.max(1, Math.ceil(Math.max(totalRowCount, 1) / resolvedPageSize))
    : undefined;
  /**
   * Upper bound used to clamp the controlled page. A cursor backend cannot
   * clamp against a page count it never receives, so the bound is "current page
   * plus one while another page exists" — enough to reject a page jump past the
   * end without forbidding the step onto the last, real page.
   */
  const pageBound = pageCount ?? Math.max(1, (pagination?.page ?? uncontrolledPage) + (pagination?.hasMore ? 1 : 0));
  const resolvedPage = pagination ? pagination.page ?? uncontrolledPage : 1;
  const currentPage = pagination ? clampPage(resolvedPage, pageBound) : 1;
  const resolvedPageSizeOptions = pagination
    ? resolvePageSizeOptions(pagination.pageSizeOptions, resolvedPageSize)
    : [];
  const visibilityState = React.useMemo(
    () => normalizeColumnVisibility(columnVisibility),
    [columnVisibility],
  );
  const sortingState = controlledSorting === undefined
    ? uncontrolledSorting
    : normalizeSortingState(controlledSorting);
  const hasSortableColumns = React.useMemo(
    () => columns.some((column) => column.sortable),
    [columns],
  );
  const columnMap = React.useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const columnDefs = React.useMemo<ColumnDef<any>[]>(
    () =>
      columns.map((column) => ({
        accessorFn: resolveColumnAccessor(column),
        enableHiding: true,
        enableSorting: !!column.sortable,
        id: column.id,
      })),
    [columns],
  );

  function handlePageChange(nextPage: number) {
    if (!pagination) {
      return;
    }

    const clampedPage = clampPage(nextPage, pageBound);

    if (pagination.page === undefined) {
      setUncontrolledPage(clampedPage);
    }

    pagination.onPageChange?.(clampedPage);
  }

  function handleSortingUpdate(updater: SortingState | ((old: SortingState) => SortingState)) {
    const nextSorting = typeof updater === 'function' ? updater(sortingState) : updater;

    if (controlledSorting === undefined && !areSortingStatesEqual(uncontrolledSorting, nextSorting)) {
      setUncontrolledSorting(nextSorting);
    }

    onSortingChange?.(toPublicSortingState(nextSorting));

    if (pagination && currentPage !== 1) {
      handlePageChange(1);
    }
  }

  function handlePageSizeChange(nextPageSizeValue: string) {
    if (!pagination) {
      return;
    }

    const nextPageSize = normalizePageSize(Number(nextPageSizeValue));

    if (nextPageSize === resolvedPageSize && currentPage === 1) {
      return;
    }

    if (pagination.pageSize === undefined) {
      setUncontrolledPageSize(nextPageSize);
    }

    if (pagination.page === undefined) {
      setUncontrolledPage(1);
    }

    pagination.onPageSizeChange?.(nextPageSize);

    if (currentPage !== 1) {
      pagination.onPageChange?.(1);
    }
  }

  const table = useReactTable({
    columns: columnDefs,
    data: rows,
    getCoreRowModel: getCoreRowModel(),
    ...(pagination && pagination.mode !== 'server'
      ? {
          getPaginationRowModel: getPaginationRowModel(),
        }
      : {}),
    ...(hasSortableColumns && sortingMode !== 'server'
      ? {
          getSortedRowModel: getSortedRowModel(),
        }
      : {}),
    getRowId: (row, index) => String(getRowId(row, index)),
    manualPagination: pagination?.mode === 'server',
    manualSorting: sortingMode === 'server',
    onSortingChange: handleSortingUpdate,
    rowCount: totalRowCount,
    state: {
      ...(pagination
        ? {
            pagination: {
              pageIndex: currentPage - 1,
              pageSize: resolvedPageSize,
            },
          }
        : {}),
      columnVisibility: visibilityState,
      sorting: sortingState,
    },
  });

  const displayedRows = table.getRowModel().rows;
  const selectedRowIdSet = new Set(selectedRowIds.map((rowId) => String(rowId)));
  const rowIds = rows.map((row, index) => getRowId(row, index));
  const displayedRowIds = displayedRows.map((row) => getRowId(row.original, row.index));
  const selectedRowCount = rowIds.filter((rowId) => selectedRowIdSet.has(String(rowId))).length;
  const allRowsSelected =
    displayedRowIds.length > 0 && displayedRowIds.every((rowId) => selectedRowIdSet.has(String(rowId)));
  const someRowsSelected =
    !allRowsSelected && displayedRowIds.some((rowId) => selectedRowIdSet.has(String(rowId)));
  /**
   * Footer summary.
   *
   * Offset pagination knows the total, so it reports a range. Cursor
   * pagination does not: `totalRowCount` would fall back to the length of the
   * current page, and `Showing 21-30 of 10` is worse than no range at all. The
   * page ordinal is rendered once, by the navigation controls, so cursor mode
   * contributes no summary here rather than repeating it.
   */
  const paginationSummary = cursorPagination
    ? undefined
    : displayedRows.length > 0
      ? `Showing ${(currentPage - 1) * resolvedPageSize + 1}-${(currentPage - 1) * resolvedPageSize + displayedRows.length} of ${totalRowCount}`
      : `Showing 0-0 of ${totalRowCount}`;

  React.useEffect(() => {
    if (!pagination || pagination.page !== undefined) {
      return;
    }

    if (uncontrolledPage !== currentPage) {
      setUncontrolledPage(currentPage);
    }
  }, [currentPage, pagination, uncontrolledPage]);

  React.useEffect(() => {
    if (!pagination || pagination.pageSize !== undefined) {
      return;
    }

    if (uncontrolledPageSize !== resolvedPageSize) {
      setUncontrolledPageSize(resolvedPageSize);
    }
  }, [pagination, resolvedPageSize, uncontrolledPageSize]);

  function handleSelectedRowIdsChange(nextSelectedIds: React.Key[]) {
    onSelectedRowIdsChange?.(nextSelectedIds);
  }

  function handleToggleAllRows(checked: boolean | 'indeterminate') {
    if (checked) {
      handleSelectedRowIdsChange(appendUniqueKeys(selectedRowIds, displayedRowIds));
      return;
    }

    const displayedIdSet = new Set(displayedRowIds.map((rowId) => String(rowId)));

    handleSelectedRowIdsChange(
      selectedRowIds.filter((selectedRowId) => !displayedIdSet.has(String(selectedRowId))),
    );
  }

  function handleToggleRow(rowId: React.Key, checked: boolean | 'indeterminate') {
    if (checked) {
      handleSelectedRowIdsChange(appendUniqueKeys(selectedRowIds, [rowId]));
      return;
    }

    handleSelectedRowIdsChange(
      selectedRowIds.filter((selectedRowId) => String(selectedRowId) !== String(rowId)),
    );
  }

  /**
   * Row click with an expanded-detail row present: the click is the
   * disclosure, so it toggles the row's own expansion and never reaches
   * `onRowClick` — a row cannot be both a disclosure and a click target.
   * Expansion toggles single-open: opening a row collapses the previous one.
   */
  const expandableRows = typeof renderExpandedRow === 'function';

  function handleRowDisclosure(rowId: React.Key) {
    const normalizedRowId = String(rowId);
    setExpandedRowId((current) => (current === normalizedRowId ? null : normalizedRowId));
  }

  function handleRowActivation(row: any, index: number, rowId: React.Key) {
    if (expandableRows) {
      handleRowDisclosure(rowId);
      return;
    }

    onRowClick?.(row, index);
  }

  // A cursor backend publishes `hasMore` but no total, so `totalRowCount`
  // degrades to the current page length and the `> 0` test would hide the
  // footer exactly when the last page is short. Cursor mode therefore keys off
  // the page itself, not off a row count it cannot receive.
  const hasPagination = !!pagination && (cursorPagination ? rows.length > 0 || currentPage > 1 : totalRowCount > 0);
  const hasFooter = !!footer || hasPagination;
  const hasPageSizeSelector = hasPagination && resolvedPageSizeOptions.length > 1;
  const paginationItems = hasPagination && pageCount !== undefined
    ? resolvePaginationItems(currentPage, pageCount)
    : [];
  const headerGroup = table.getHeaderGroups()[0];

  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-4', className)}
      data-sdk-ui="data-table"
      data-slot="data-table"
      {...props}
    >
      {title || description || toolbar ? (
        <div
          data-sdk-region="data-table-header"
          {...mergeSlotProps(
            {
              className: 'flex flex-wrap items-start justify-between gap-3',
              'data-slot': 'data-table-header',
            },
            slotProps?.header,
          )}
        >
          <div className="min-w-0">
            {title ? (
              <div className="text-base font-semibold text-[var(--sdk-color-text-primary)]" data-slot="data-table-title">
                {title}
              </div>
            ) : null}
            {description ? (
              <div className="mt-1 text-sm text-[var(--sdk-color-text-secondary)]" data-slot="data-table-description">
                {description}
              </div>
            ) : null}
          </div>
          {toolbar ? (
            <div
              data-sdk-region="data-table-toolbar"
              {...mergeSlotProps<DataTableRegionSlotProps>(
                { 'data-slot': 'data-table-toolbar' },
                slotProps?.toolbar,
              )}
            >
              {toolbar}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedRowCount > 0 ? (
        <BulkActionBar
          actions={selectionBar?.actions}
          clearLabel={selectionBar?.clearLabel}
          count={selectedRowCount}
          description={selectionBar?.description}
          meta={selectionBar?.meta}
          onClear={onSelectedRowIdsChange ? () => handleSelectedRowIdsChange([]) : undefined}
          sticky={selectionBar?.sticky}
          title={selectionBar?.title ?? 'Selected rows'}
          tone={selectionBar?.tone}
        />
      ) : null}

      <div
        data-sdk-region="data-table-surface"
        {...mergeSlotProps(
          {
            className: dataTableSurfaceClassName,
            'data-slot': 'data-table-surface',
          },
          slotProps?.surface,
        )}
      >
        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
            <LoadingBlock label={loadingLabel} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
            {emptyState ?? <EmptyState description={emptyDescription} title={emptyTitle} />}
          </div>
        ) : (
          <Table
            viewportClassName={slotProps?.viewport?.className}
            {...mergeSlotProps(
              {},
              slotProps?.table,
            )}
          >
            <TableHeader>
              <TableRow>
                {selectable ? (
                  <TableHead className="w-12">
                    <Checkbox
                      aria-label="Select all rows"
                      checked={allRowsSelected ? true : someRowsSelected ? 'indeterminate' : false}
                      onCheckedChange={handleToggleAllRows}
                    />
                  </TableHead>
                ) : null}
                {headerGroup?.headers
                  .filter((header) => !header.isPlaceholder)
                  .map((header) => {
                    const column = columnMap.get(header.column.id);

                    if (!column) {
                      return null;
                    }

                    return (
                      <DataTableHeaderCell
                        column={column}
                        key={header.id}
                        sortColumn={header.column}
                        stickyHeader={stickyHeader}
                      />
                    );
                  })}
                {rowActions ? (
                  <TableHead
                    className={cn(
                      'w-1 whitespace-nowrap text-right',
                      stickyHeader ? 'sticky top-0 z-10 bg-[var(--sdk-color-surface-panel)]' : null,
                    )}
                  >
                    {rowActionsLabel}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedRows.map((tableRow) => {
                const row = tableRow.original;
                const index = tableRow.index;
                const rowId = getRowId(row, index);
                const normalizedRowId = String(rowId);
                const selected = selectedRowIdSet.has(normalizedRowId);
                const rowSelectionLabel = getRowSelectionLabel?.(row, index) ?? String(rowId);
                const resolvedRowProps = getRowProps?.(row, index);
                const expanded = expandableRows && expandedRowId === normalizedRowId;
                const rowExpandLabel = expandableRows
                  ? getRowExpandLabel?.(row, index, expanded) ?? normalizedRowId
                  : undefined;
                const detailColumnCount =
                  (selectable ? 1 : 0)
                  + tableRow.getVisibleCells().length
                  + (rowActions ? 1 : 0);

                return (
                  <React.Fragment key={normalizedRowId}>
                    <TableRow
                      {...mergeSlotProps<DataTableRowProps>(
                        {
                          className: cn(
                            'hover:bg-[var(--sdk-color-brand-primary-soft)]',
                            onRowClick || expandableRows ? 'cursor-pointer' : null,
                          ),
                          'aria-expanded': expandableRows ? expanded : undefined,
                          'aria-label': rowExpandLabel,
                          'data-sdk-row-id': normalizedRowId,
                          'data-state': selected ? 'selected' : 'unselected',
                          tabIndex: expandableRows ? 0 : undefined,
                        },
                        resolvedRowProps,
                      )}
                      onClick={onRowClick || expandableRows ? () => handleRowActivation(row, index, rowId) : undefined}
                      onKeyDown={expandableRows
                        ? (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleRowDisclosure(rowId);
                          }
                        }
                        : undefined}
                    >
                      {selectable ? (
                        <TableCell className={densityClassName[density]}>
                          <Checkbox
                            aria-label={`Select row ${rowSelectionLabel}`}
                            checked={selected}
                            onCheckedChange={(checked) => handleToggleRow(rowId, checked)}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </TableCell>
                      ) : null}
                      {tableRow.getVisibleCells().map((cell) => {
                        const column = columnMap.get(cell.column.id);

                        if (!column) {
                          return null;
                        }

                        const resolvedCellProps =
                          typeof column.cellProps === 'function'
                            ? column.cellProps(row, index)
                            : column.cellProps;

                        return (
                          <TableCell
                            {...mergeSlotProps<DataTableCellProps>(
                              {
                                className: cn(
                                  densityClassName[density],
                                  alignClassName[column.align ?? 'left'],
                                ),
                              },
                              resolvedCellProps,
                            )}
                            key={cell.id}
                          >
                            {column.cell(row, index)}
                          </TableCell>
                        );
                      })}
                      {rowActions ? (
                        <TableCell className={cn(densityClassName[density], 'text-right')}>
                          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                            {rowActions(row, index)}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                    {expanded ? (
                      <TableRow data-state="expanded" data-sdk-row-id={`${normalizedRowId}-detail`}>
                        <TableCell colSpan={detailColumnCount}>
                          {rowDetailLabel ? (
                            <div className="mb-2 text-sm font-semibold text-[var(--sdk-color-text-secondary)]" data-slot="data-table-row-detail-label">
                              {rowDetailLabel}
                            </div>
                          ) : null}
                          <div onClick={(event) => event.stopPropagation()}>
                            {renderExpandedRow?.(row, index)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}

        {hasFooter ? (
          <div
            data-sdk-region="data-table-footer"
            {...mergeSlotProps(
              {
                className: dataTableFooterClassName,
                'data-slot': 'data-table-footer',
              },
              slotProps?.footer,
            )}
          >
            <div className={dataTableSummaryClassName}>
              {footer}
              {hasPagination && paginationSummary !== undefined ? <span>{paginationSummary}</span> : null}
            </div>
            {hasPagination ? (
              <div
                data-sdk-region="data-table-pagination"
                {...mergeSlotProps<DataTableRegionSlotProps>(
                  { 'data-slot': 'data-table-pagination' },
                  slotProps?.pagination,
                )}
              >
                <DataTablePaginationControls
                  currentPage={currentPage}
                  hasNextPage={cursorPagination ? !!pagination?.hasMore : pageCount !== undefined && currentPage < pageCount}
                  hasPageNumberList={pageCount !== undefined}
                  hasPageSizeSelector={hasPageSizeSelector}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  pageSizeOptions={resolvedPageSizeOptions}
                  paginationItems={paginationItems}
                  resolvedPageSize={resolvedPageSize}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export { DataTable };
DataTable.displayName = 'DataTable';
