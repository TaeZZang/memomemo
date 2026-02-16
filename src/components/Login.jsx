import React from 'react';
import { auth, provider } from '../firebase';
import { signInWithPopup } from 'firebase/auth';

export default function Login() {
    const handleLogin = async () => {
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Login failed:", error);
        }
    };

    return (
        <div className="login-container">
            <h1>Daily Memo</h1>
            <p>오늘의 할 일을 기록하고 동기화하세요.</p>
            <button className="auth-button" onClick={handleLogin}>
                Google 계정으로 시작하기
            </button>
        </div>
    );
}
