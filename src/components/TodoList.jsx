import React, { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { db, auth } from '../firebase';
import {
    collection, addDoc, query, where, onSnapshot, deleteDoc, doc, updateDoc,
    orderBy, serverTimestamp, writeBatch
} from 'firebase/firestore';
import { DragDropContext, Draggable } from '@hello-pangea/dnd';
import { StrictModeDroppable } from './StrictModeDroppable';
import DailyResetModal from './DailyResetModal';
import HistoryCalendar from './HistoryCalendar';

export default function TodoList({ user }) {
    const [viewMode, setViewMode] = useState('daily'); // 'daily' or 'history'
    const [historyTodos, setHistoryTodos] = useState([]);
    const [syncSource, setSyncSource] = useState('연결 중...');


    // Core State
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [todos, setTodos] = useState([]);

    // Force re-render of Droppables to clean up stuck state
    const [droppableKey, setDroppableKey] = useState(0);

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

        // Timeout fallback if connection hangs
        const timeoutId = setTimeout(() => {
            setSyncSource("❌ 연결 시간 초과 (방화벽/네트워크 확인 필요)");
        }, 5000);

        const q = query(
            collection(db, 'todos'),
            where('uid', '==', user.uid),
            orderBy('order', 'asc') // Changed from sorting by createdAt to order
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            clearTimeout(timeoutId);

            // BLOCK UPDATES IF DRAGGING
            if (isDraggingRef.current) {
                console.log("🚫 Snapshot ignored during drag");
                return;
            }

            console.log("🔥 Snapshot fired! Docs:", snapshot.docs.length, "Metadata:", snapshot.metadata); // Debug log

            let statusText = "✅ 최신 상태";
            if (snapshot.metadata.fromCache) {
                statusText = "⚠️ 오프라인 모드";
            }

            setSyncSource(statusText);

            let todosData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Fallback for items without 'order'
            todosData = todosData.map(t => {
                if (t.order === undefined) {
                    const time = t.createdAt ? (t.createdAt.toDate ? t.createdAt.toDate().getTime() : new Date(t.createdAt).getTime()) : Date.now();
                    return { ...t, order: time };
                }
                return t;
            });
            // Sort by order ASC
            todosData.sort((a, b) => a.order - b.order);

            // Log the order of first few items to check sync
            if (todosData.length > 0) {
                console.log("Snapshot Top 3 Orders:", todosData.slice(0, 3).map(t => t.order));
                console.log("Snapshot Top 3 Texts:", todosData.slice(0, 3).map(t => t.text));
            }

            // Split into Today's Todos and History
            const current = todosData.filter(t => t.isArchived !== true);
            const history = todosData.filter(t => t.isArchived === true);

            setTodos(current);
            setHistoryTodos(history);

            if (!snapshot.metadata.fromCache) {
                checkDailyReset(current);
            }
        }, (error) => {
            console.error("Firestore Listen Error:", error);
            setSyncSource("❌ 연결 오류");
        });

        return () => unsubscribe();
    }, [user, selectedDate, db]); // Dependencies

    // CRUD Functions
    const addTodo = async (e) => {
        if (e) e.preventDefault();

        if (input.trim() === '') return;
        if (!user || !user.uid) {
            alert("로그인 정보가 없습니다.");
            return;
        }

        const currentInput = input;
        setInput('');

        // Calculate new order
        const minOrder = (todos.length > 0 && typeof todos[0].order === 'number')
            ? todos[0].order
            : Date.now();

        const newOrder = minOrder - 100000;

        try {
            await addDoc(collection(db, 'todos'), {
                text: currentInput,
                completed: false,
                uid: user.uid,
                createdAt: new Date(),
                isArchived: false,
                order: newOrder
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
            alert("하루가 시작되었습니다! ☀️");
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

    // Ref to track drag status to prevent snapshot interference
    const isDraggingRef = React.useRef(false);

    const handleOnDragStart = () => {
        isDraggingRef.current = true;
    };

    const handleOnDragEnd = async (result) => {
        console.log("🖱️ Drag Ended:", result);

        // [핵심] 드래그 로직을 안전하게 감싸서 에러 발생 시에도 상태를 해제합니다.
        try {
            const { source, destination } = result;

            // [유효성 검사]
            if (!destination) return;
            if (source.droppableId !== destination.droppableId) return;
            if (destination.index === source.index) return;

            // [리스트 확인]
            const isCompletedList = source.droppableId === 'completed-list';
            const listItems = isCompletedList ? completedTodos : activeTodos;

            // 1. 배열 재배치
            const reorderedList = Array.from(listItems);
            const [movedItem] = reorderedList.splice(source.index, 1);
            reorderedList.splice(destination.index, 0, movedItem);

            const prevItem = reorderedList[destination.index - 1];
            const nextItem = reorderedList[destination.index + 1];

            // 2. 새 순서(Order) 계산
            let newOrder;
            if (!prevItem && !nextItem) {
                newOrder = Date.now();
            } else if (!prevItem) {
                newOrder = nextItem.order - 100000;
            } else if (!nextItem) {
                newOrder = prevItem.order + 100000;
            } else {
                newOrder = (prevItem.order + nextItem.order) / 2;
            }

            // 안전 장치
            if (!newOrder || isNaN(newOrder)) {
                newOrder = Date.now();
            }

            console.log("🔢 New Order:", newOrder);

            // 3. [낙관적 업데이트] 화면 즉시 갱신
            // FORCE REACT TO UPDATE DOM NOW using flushSync
            flushSync(() => {
                const updatedTodos = todos.map(t => {
                    if (t.id === movedItem.id) {
                        return { ...t, order: newOrder };
                    }
                    return t;
                });

                updatedTodos.sort((a, b) => a.order - b.order);
                setTodos(updatedTodos);
            });

            // 4. [서버 저장] 비동기 요청 (에러만 캐치)
            try {
                await updateDoc(doc(db, 'todos', movedItem.id), {
                    order: newOrder
                });
            } catch (error) {
                console.error("Failed to reorder:", error);
                alert("순서 변경 실패: " + error.message);
            }

        } catch (err) {
            console.error("Drag Logic Error:", err);
        } finally {
            // [상태 해제]
            // flushSync로 이미 화면이 그려졌으므로, 
            // 다음 프레임에 안전하게 드래그 구역을 초기화합니다.
            requestAnimationFrame(() => {
                flushSync(() => {
                    setDroppableKey(prev => prev + 1);
                });
                isDraggingRef.current = false;
            });
        }
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
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                        e.preventDefault();
                                        addTodo(e);
                                    }
                                }}
                                autoFocus
                            />
                            <button type="submit">+</button>
                        </form>

                        <DragDropContext onDragEnd={handleOnDragEnd} onDragStart={handleOnDragStart}>
                            <h3 className="section-title">진행 중 ({activeTodos.length})</h3>
                            <StrictModeDroppable droppableId="active-list">
                                {(provided) => (
                                    <ul className="todo-list" {...provided.droppableProps} ref={provided.innerRef}>
                                        {activeTodos.map((todo, index) => (
                                            <Draggable key={todo.id} draggableId={todo.id} index={index}>
                                                {(provided, snapshot) => {
                                                    if (snapshot.isDragging) {
                                                        console.log(`RENDER: Item ${todo.id} isDragging=${snapshot.isDragging}`);
                                                    }
                                                    return (
                                                        <li
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            className={snapshot.isDragging ? 'is-dragging' : ''}
                                                            style={{ ...provided.draggableProps.style }}
                                                        >
                                                            <div className="drag-handle" {...provided.dragHandleProps}>⋮⋮</div>
                                                            <div className="todo-content" onClick={() => toggleComplete(todo)}>
                                                                <div className="checkbox"></div>
                                                                <span>{todo.text}</span>
                                                            </div>
                                                            <button onClick={() => deleteTodo(todo.id)} className="delete-btn">×</button>
                                                        </li>
                                                    );
                                                }}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                        {activeTodos.length === 0 && <p className="empty-msg"> 일이 없습니다. 쉬세요! ☕</p>}
                                    </ul>
                                )}
                            </StrictModeDroppable>

                            {completedTodos.length > 0 && (
                                <>
                                    <h3 className="section-title">완료된 일 ({completedTodos.length})</h3>
                                    <StrictModeDroppable droppableId="completed-list">
                                        {(provided) => (
                                            <ul className="todo-list completed-section" {...provided.droppableProps} ref={provided.innerRef}>
                                                {completedTodos.map((todo, index) => (
                                                    <Draggable key={todo.id} draggableId={todo.id} index={index}>
                                                        {(provided, snapshot) => (
                                                            <li
                                                                key={todo.id}
                                                                className={`completed ${snapshot.isDragging ? 'is-dragging' : ''}`}
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                style={{ ...provided.draggableProps.style }}
                                                            >
                                                                <div className="drag-handle" {...provided.dragHandleProps}>⋮⋮</div>
                                                                <div className="todo-content" onClick={() => toggleComplete(todo)}>
                                                                    <div className="checkbox checked"></div>
                                                                    <span>{todo.text}</span>
                                                                </div>
                                                                <button onClick={() => deleteTodo(todo.id)} className="delete-btn">×</button>
                                                            </li>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </ul>
                                        )}
                                    </StrictModeDroppable>
                                </>
                            )}
                        </DragDropContext>
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
