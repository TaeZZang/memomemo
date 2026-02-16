import React, { useState } from 'react';

export default function DailyResetModal({ tasks, onConfirm }) {
    // Default to all selected
    const [selectedIds, setSelectedIds] = useState(tasks.map(t => t.id));

    const toggleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id)
                ? prev.filter(p => p !== id)
                : [...prev, id]
        );
    };

    const handleConfirm = () => {
        onConfirm(selectedIds);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>🌞 새로운 하루가 시작되었습니다!</h2>
                <p>어제 완료하지 못한 일들을 오늘로 가져갈까요?</p>

                <ul className="modal-task-list">
                    {tasks.map(task => (
                        <li key={task.id} className="modal-task-item" onClick={() => toggleSelect(task.id)}>
                            <div className={`checkbox ${selectedIds.includes(task.id) ? 'checked' : ''}`}></div>
                            <span>{task.text}</span>
                        </li>
                    ))}
                </ul>

                <div className="modal-actions">
                    <button type="button" onClick={handleConfirm} className="confirm-btn">
                        선택한 항목 가져오기
                    </button>
                </div>
                <p className="modal-hint">* 선택하지 않은 항목은 삭제됩니다.</p>
            </div>
        </div>
    );
}
