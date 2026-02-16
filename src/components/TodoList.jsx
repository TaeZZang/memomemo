import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import {
    collection, addDoc, query, where, onSnapshot, deleteDoc, doc, updateDoc,
    orderBy, serverTimestamp, writeBatch
} from 'firebase/firestore';
import DailyResetModal from './DailyResetModal';
import HistoryCalendar from './HistoryCalendar';

export default function TodoList({ user }) {
    const [viewMode, setViewMode] = useState('daily'); // 'daily' or 'history'
    const [historyTodos, setHistoryTodos] = useState([]);

    // Core State
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [todos, setTodos] = useState([]);
    const [input, setInput] = useState('');
    const [resetCandidates, setResetCandidates] = useState([]);
    const [showResetModal, setShowResetModal] = useState(false);

    // Helpers
    const getToday4AM = () => {
        const now = new Date();
        const fourAM = new Date(now);
        fourAM.setHours(4, 0, 0, 0);
        if (now < fourAM) {
            fourAM.setDate(fourAM.getDate() - 1);
        }
        return fourAM;
    };

    const checkDailyReset = (currentTodos, manualBoundary = null) => {
        const boundary = manualBoundary || getToday4AM();
        const candidates = [];
        const batch = writeBatch(db);
        let hasBatchUpdates = false;

        currentTodos.forEach(todo => {
            if (!todo.createdAt) return;
            // Handle Timestamp vs Date
            const todoDate = todo.createdAt.toDate ? todo.createdAt.toDate() : todo.createdAt;

            if (todoDate < boundary) {
                if (todo.completed) {
                    const ref = doc(db, 'todos', todo.id);
                    batch.update(ref, { isArchived: true });
                    hasBatchUpdates = true;
                } else {
                    candidates.push(todo);
                }
            }
        });

        if (hasBatchUpdates) {
            batch.commit().catch(e => console.error("Batch archive failed", e));
        }

        // Show modal if there are candidates
        if (candidates.length > 0) {
            setResetCandidates(candidates);
            setShowResetModal(true);
        }
    };

    // 4 AM Login Logic & Data Fetching
    useEffect(() => {
        if (!user) return;

        const q = query(
            collection(db, 'todos'),
            where('uid', '==', user.uid)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let todosData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Sort Descending by createdAt
            todosData.sort((a, b) => {
                const timeA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : a.createdAt) : new Date(8640000000000000);
                const timeB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : b.createdAt) : new Date(8640000000000000);
                return timeB - timeA;
            });

            // Split into Today's Todos and History
            const current = todosData.filter(t => t.isArchived !== true);
            const history = todosData.filter(t => t.isArchived === true);

            setTodos(current);
            setHistoryTodos(history);
            checkDailyReset(current);
        }, (error) => {
            console.error("Firestore Listen Error:", error);
        });

        return () => unsubscribe();
    }, [user]);

    // CRUD Functions
    const addTodo = async (e) => {
        e.preventDefault();

        if (input.trim() === '') return;
        if (!user || !user.uid) {
            alert("로그인 정보가 없습니다.");
            return;
        }

        const currentInput = input;
        setInput('');

        try {
            await addDoc(collection(db, 'todos'), {
                text: currentInput,
                completed: false,
                uid: user.uid,
                createdAt: new Date(),
                isArchived: false
            });
        } catch (error) {
            console.error("Error adding todo:", error);
            alert("저장 실패: " + error.message);
            setInput(currentInput);
        }
    };

    const toggleComplete = async (todo) => {
        await updateDoc(doc(db, 'todos', todo.id), {
            completed: !todo.completed
        });
    };

    const deleteTodo = async (id) => {
        await deleteDoc(doc(db, 'todos', id));
    };

    const handleCarryOver = async (selectedIds) => {
        // Optimistic UI
        setShowResetModal(false);
        setResetCandidates([]);

        const batch = writeBatch(db);

        // 1. Keep selected: Update createdAt to NOW
        selectedIds.forEach(id => {
            const ref = doc(db, 'todos', id);
            batch.update(ref, { createdAt: new Date() });
        });

        // 2. Discard unselected: Archive them
        const unselected = resetCandidates.filter(t => !selectedIds.includes(t.id));
        unselected.forEach(t => {
            const ref = doc(db, 'todos', t.id);
            batch.update(ref, { isArchived: true });
        });

        try {
            await batch.commit();
            alert("하루 정리가 완료되었습니다! 🌅");
        } catch (error) {
            console.error("Carry-over error:", error);
            alert("정리 중 오류 발생: " + error.message);
        }
    };

    const handleManualReset = () => {
        if (!window.confirm("오늘 하루를 마무리하시겠습니까?\n완료된 일은 보관되고, 남은 일은 내일로 넘길지 선택합니다.")) return;

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1); // Tomorrow
        checkDailyReset(todos, futureDate);
    };

    const handleSwitchView = () => {
        setViewMode(prev => prev === 'daily' ? 'history' : 'daily');
    };

    // Helper to group history by date
    const groupedHistory = historyTodos.reduce((groups, todo) => {
        const date = todo.createdAt ? (todo.createdAt.toDate ? todo.createdAt.toDate() : todo.createdAt) : new Date();
        const dateStr = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

        if (!groups[dateStr]) {
            groups[dateStr] = [];
        }
        groups[dateStr].push(todo);
        return groups;
    }, {});

    // Filter History by Selected Date
    const selectedDateStr = selectedDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const selectedHistoryItems = groupedHistory[selectedDateStr] || [];

    // Derived State for Current View
    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    return (
        <>
            {showResetModal && (
                <DailyResetModal
                    tasks={resetCandidates}
                    onConfirm={handleCarryOver}
                />
            )}
            <div className="todo-container">
                <header>
                    <h2>안녕하세요, {user.displayName}님! 👋</h2>
                    <div className="header-actions">
                        <button onClick={handleSwitchView} className="reset-btn" title={viewMode === 'daily' ? "지난 기록 보기" : "오늘 할 일 보기"}>
                            {viewMode === 'daily' ? '📅' : '📝'}
                        </button>
                        {viewMode === 'daily' && (
                            <button onClick={handleManualReset} className="reset-btn" title="하루 마무리">🌙</button>
                        )}
                        <button onClick={() => auth.signOut()} className="logout-btn">로그아웃</button>
                    </div>
                </header>

                {viewMode === 'daily' ? (
                    <>
                        <form onSubmit={addTodo} className="input-form">
                            <input
                                type="text"
                                placeholder="오늘 할 일을 입력하세요..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                            />
                            <button type="submit">+</button>
                        </form>

                        <h3 className="section-title">진행 중 ({activeTodos.length})</h3>
                        <ul className="todo-list">
                            {activeTodos.map(todo => (
                                <li key={todo.id}>
                                    <div className="todo-content" onClick={() => toggleComplete(todo)}>
                                        <div className="checkbox"></div>
                                        <span>{todo.text}</span>
                                    </div>
                                    <button onClick={() => deleteTodo(todo.id)} className="delete-btn">×</button>
                                </li>
                            ))}
                            {activeTodos.length === 0 && <p className="empty-msg">할 일이 없습니다. 쉬세요! ☕</p>}
                        </ul>

                        {completedTodos.length > 0 && (
                            <>
                                <h3 className="section-title">완료된 일 ({completedTodos.length})</h3>
                                <ul className="todo-list completed-section">
                                    {completedTodos.map(todo => (
                                        <li key={todo.id} className="completed">
                                            <div className="todo-content" onClick={() => toggleComplete(todo)}>
                                                <div className="checkbox checked"></div>
                                                <span>{todo.text}</span>
                                            </div>
                                            <button onClick={() => deleteTodo(todo.id)} className="delete-btn">×</button>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </>
                ) : (
                    <div className="history-view">
                        <h3 className="section-title">📜 지난 기록</h3>

                        <HistoryCalendar
                            historyData={groupedHistory}
                            onSelectDate={setSelectedDate}
                            selectedDate={selectedDate}
                        />

                        {selectedHistoryItems.length === 0 ? (
                            <p className="empty-msg">
                                {selectedDate.toLocaleDateString('ko-KR')}에 기록된 일이 없습니다.
                            </p>
                        ) : (
                            <div className="history-group">
                                <h4 className="history-date">
                                    {selectedDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                                </h4>
                                <ul className="todo-list completed-section">
                                    {selectedHistoryItems.map(todo => (
                                        <li key={todo.id} className="completed">
                                            <div className="todo-content">
                                                <div className="checkbox checked"></div>
                                                <span>{todo.text}</span>
                                            </div>
                                            <button onClick={() => deleteTodo(todo.id)} className="delete-btn">×</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
