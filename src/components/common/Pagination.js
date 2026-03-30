import React from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';

const Pagination = ({ currentPage, totalItems, itemsPerPage, onPageChange, onItemsPerPageChange }) => {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);

    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;
        let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) {
            start = Math.max(1, end - maxVisible + 1);
        }
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        return pages;
    };

    if (totalItems === 0) return null;

    return (
        <div className="pagination-container">
            <div className="pagination-info">
                Showing <strong>{startItem}–{endItem}</strong> of <strong>{totalItems}</strong>
            </div>
            <div className="pagination-controls">
                <button
                    className="btn btn-ghost btn-sm pagination-btn"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    title="Previous page"
                >
                    <MdChevronLeft size={18} />
                </button>
                {getPageNumbers().map(page => (
                    <button
                        key={page}
                        className={`btn btn-sm pagination-btn ${page === currentPage ? 'pagination-btn-active' : 'btn-ghost'}`}
                        onClick={() => onPageChange(page)}
                    >
                        {page}
                    </button>
                ))}
                <button
                    className="btn btn-ghost btn-sm pagination-btn"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    title="Next page"
                >
                    <MdChevronRight size={18} />
                </button>
            </div>
            {onItemsPerPageChange && (
                <div className="pagination-per-page">
                    <span>Rows:</span>
                    <select
                        className="form-select pagination-select"
                        value={itemsPerPage}
                        onChange={(e) => {
                            onItemsPerPageChange(Number(e.target.value));
                            onPageChange(1);
                        }}
                    >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </div>
            )}
        </div>
    );
};

export default Pagination;
