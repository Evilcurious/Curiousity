"""AI provider & model APIs — user-facing model list + admin CRUD + connection tests."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agent.providers.registry import build_adapter_from_values
from app.core.deps import client_ip, get_current_admin, get_current_user
from app.core.events import audit
from app.core.security import encrypt
from app.database import get_db
from app.models import AIModel, AIProvider, User, UserModelPermission
from app.schemas import (
    ModelCreate, ModelOut, ModelUpdate, ProviderCreate, ProviderOut, ProviderUpdate,
    TestConnectionRequest, TestConnectionResponse,
)

router = APIRouter(tags=["providers"])


def _provider_out(p: AIProvider) -> ProviderOut:
    return ProviderOut(
        id=p.id, name=p.name, provider_type=p.provider_type, base_url=p.base_url,
        custom_headers=p.custom_headers, enabled=p.enabled, is_system=p.is_system,
        has_api_key=bool(p.api_key_enc), created_at=p.created_at,
    )


def _model_out(m: AIModel) -> ModelOut:
    return ModelOut(
        id=m.id, provider_id=m.provider_id, model_id=m.model_id,
        display_name=m.display_name or m.model_id, context_length=m.context_length,
        max_output_tokens=m.max_output_tokens, temperature=m.temperature, top_p=m.top_p,
        enabled=m.enabled, is_default=m.is_default,
        provider_name=m.provider.name if m.provider else None,
        provider_type=m.provider.provider_type if m.provider else None,
    )


# ------------------------------------------------------------------ user-facing
@router.get("/models", response_model=List[ModelOut])
def list_available_models(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Models this user may use (enabled models minus explicit denials)."""
    models = (
        db.query(AIModel)
        .join(AIProvider, AIModel.provider_id == AIProvider.id)
        .filter(AIModel.enabled.is_(True), AIProvider.enabled.is_(True))
        .all()
    )
    result = []
    for m in models:
        perm = db.query(UserModelPermission).filter(
            UserModelPermission.user_id == user.id, UserModelPermission.model_id == m.id).first()
        if perm is not None and not perm.allowed:
            continue
        result.append(_model_out(m))
    return result


@router.post("/models/test", response_model=TestConnectionResponse)
async def test_model_connection(body: TestConnectionRequest,
                                user: User = Depends(get_current_admin),
                                db: Session = Depends(get_db)):
    provider_type, base_url, api_key, headers = body.provider_type, body.base_url, body.api_key, body.custom_headers
    model_id = ""
    if body.provider_id:
        provider = db.get(AIProvider, body.provider_id)
        if provider is None:
            raise HTTPException(status_code=404, detail="Provider not found")
        provider_type = provider.provider_type
        base_url = provider.base_url
        headers = provider.custom_headers
        if api_key is None and provider.api_key_enc:
            from app.core.security import decrypt
            api_key = decrypt(provider.api_key_enc)
        first_model = db.query(AIModel).filter(AIModel.provider_id == provider.id).first()
        model_id = first_model.model_id if first_model else ""
    if not provider_type:
        raise HTTPException(status_code=400, detail="provider_type or provider_id required")
    adapter = build_adapter_from_values(provider_type, base_url or "", api_key, model_id, headers)
    ok, message = await adapter.test_connection()
    models: List[str] = []
    if ok:
        try:
            models = (await adapter.list_models())[:50]
        except Exception:
            pass
    return TestConnectionResponse(ok=ok, message=message, models=models)


# ------------------------------------------------------------------ admin: providers
@router.get("/admin/providers", response_model=List[ProviderOut])
def admin_list_providers(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return [_provider_out(p) for p in db.query(AIProvider).order_by(AIProvider.created_at).all()]


@router.post("/admin/providers", response_model=ProviderOut)
def admin_create_provider(body: ProviderCreate, request: Request,
                          admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    if db.query(AIProvider).filter(AIProvider.name == body.name).first():
        raise HTTPException(status_code=409, detail="Provider name already exists")
    provider = AIProvider(
        name=body.name, provider_type=body.provider_type, base_url=body.base_url,
        api_key_enc=encrypt(body.api_key) if body.api_key else None,
        custom_headers=body.custom_headers, enabled=body.enabled,
    )
    db.add(provider)
    audit(db, "admin.provider_created", user_id=admin.id, resource_type="provider",
          details={"name": body.name}, ip=client_ip(request))
    db.commit()
    db.refresh(provider)
    return _provider_out(provider)


@router.patch("/admin/providers/{provider_id}", response_model=ProviderOut)
def admin_update_provider(provider_id: str, body: ProviderUpdate, request: Request,
                          admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    provider = db.get(AIProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    if body.name is not None:
        provider.name = body.name
    if body.base_url is not None:
        provider.base_url = body.base_url
    if body.api_key is not None:
        provider.api_key_enc = encrypt(body.api_key) if body.api_key else None
    if body.custom_headers is not None:
        provider.custom_headers = body.custom_headers
    if body.enabled is not None:
        provider.enabled = body.enabled
    audit(db, "admin.provider_updated", user_id=admin.id, resource_type="provider",
          resource_id=provider_id, ip=client_ip(request))
    db.commit()
    db.refresh(provider)
    return _provider_out(provider)


@router.delete("/admin/providers/{provider_id}")
def admin_delete_provider(provider_id: str, request: Request,
                          admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    provider = db.get(AIProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    if provider.is_system:
        raise HTTPException(status_code=400, detail="The system provider cannot be deleted — disable it instead")
    db.delete(provider)
    audit(db, "admin.provider_deleted", user_id=admin.id, resource_type="provider",
          resource_id=provider_id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ admin: models
@router.get("/admin/models", response_model=List[ModelOut])
def admin_list_models(admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    return [_model_out(m) for m in db.query(AIModel).order_by(AIModel.created_at).all()]


@router.post("/admin/models", response_model=ModelOut)
def admin_create_model(body: ModelCreate, request: Request,
                       admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    provider = db.get(AIProvider, body.provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    model = AIModel(**body.model_dump())
    db.add(model)
    audit(db, "admin.model_created", user_id=admin.id, resource_type="model",
          details={"model_id": body.model_id}, ip=client_ip(request))
    db.commit()
    db.refresh(model)
    return _model_out(model)


@router.patch("/admin/models/{model_id}", response_model=ModelOut)
def admin_update_model(model_id: str, body: ModelUpdate, request: Request,
                       admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    model = db.get(AIModel, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("is_default"):
        for other in db.query(AIModel).filter(AIModel.is_default.is_(True)):
            other.is_default = False
    for key, value in data.items():
        setattr(model, key, value)
    audit(db, "admin.model_updated", user_id=admin.id, resource_type="model",
          resource_id=model_id, ip=client_ip(request))
    db.commit()
    db.refresh(model)
    return _model_out(model)


@router.delete("/admin/models/{model_id}")
def admin_delete_model(model_id: str, request: Request,
                       admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    model = db.get(AIModel, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    db.delete(model)
    audit(db, "admin.model_deleted", user_id=admin.id, resource_type="model",
          resource_id=model_id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


class ModelPermissionBody(BaseModel):
    allowed: bool = True


@router.put("/admin/models/{model_id}/permissions/{user_id}")
def set_model_permission(model_id: str, user_id: str, body: ModelPermissionBody,
                         admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Set per-user model permission."""
    model = db.get(AIModel, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    allowed = body.allowed
    perm = db.query(UserModelPermission).filter(
        UserModelPermission.user_id == user_id, UserModelPermission.model_id == model_id).first()
    if perm is None:
        perm = UserModelPermission(user_id=user_id, model_id=model_id, allowed=allowed)
        db.add(perm)
    else:
        perm.allowed = allowed
    audit(db, "admin.model_permission_set", user_id=admin.id, resource_type="model",
          resource_id=model_id, details={"target_user": user_id, "allowed": allowed},
          ip=client_ip(request))
    db.commit()
    return {"ok": True, "allowed": perm.allowed}
