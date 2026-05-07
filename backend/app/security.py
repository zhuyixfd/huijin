from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings

_ROUNDS = 12


def hash_password(plain: str) -> str:
    data = plain.encode("utf-8")[:72]
    return bcrypt.hashpw(data, bcrypt.gensalt(rounds=_ROUNDS)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("ascii"))
    except ValueError:
        return False


def create_access_token(user_id: int, username: str) -> str:
    exp = int(
        (datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()
    )
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": exp,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
