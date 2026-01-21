# Microservices Deployment Guide - Hetzner Server k3s

Bu dokümantasyon, mikroservis uygulamanızı Hetzner Server'da k3s (lightweight Kubernetes) kullanarak production-ready şekilde deploy etmek için adım adım kılavuz içerir.

## İçindekiler

1. [Hetzner Server Hazırlığı](#hetzner-server-hazırlığı)
2. [k3s Kurulumu](#k3s-kurulumu)
3. [Gerekli Araçların Kurulumu](#gerekli-araçların-kurulumu)
4. [Docker Image'ları Build ve Push](#docker-imageları-build-ve-push)
5. [Helm Chart Hazırlığı](#helm-chart-hazırlığı)
6. [Deployment](#deployment)
7. [Monitoring ve Logging](#monitoring-ve-logging)
8. [Troubleshooting](#troubleshooting)

## Hetzner Server Hazırlığı

### 1. Hetzner Cloud'da Server Oluşturma

1. Hetzner Cloud Console'a giriş yapın: https://console.hetzner.cloud
2. "Add Server" butonuna tıklayın
3. Ayarları yapın:
   - **Location**: Nuremberg, Falkenstein, veya Helsinki
   - **Image**: Ubuntu 22.04
   - **Type**: CPX21 (2 vCPU, 4GB RAM) veya daha büyük (önerilen: CPX31 - 4 vCPU, 8GB RAM)
   - **SSH Keys**: Kendi SSH key'inizi ekleyin
   - **Networks**: Varsayılan network yeterli
   - **Firewalls**: İlk aşamada firewall eklemeyin (sonra yapılandırabilirsiniz)

### 2. Server'a Bağlanma

```bash
ssh root@your-server-ip
```

### 3. Sistem Güncellemesi

```bash
apt update && apt upgrade -y
reboot
```

## k3s Kurulumu

### 1. k3s Master Node Kurulumu

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.28.0+k3s1 sh -

k3s kubectl get node
```

### 2. kubeconfig Dosyasını Yerel Makineye Kopyalama

```bash
mkdir -p ~/.kube
scp root@your-server-ip:/etc/rancher/k3s/k3s.yaml ~/.kube/config-hetzner

sed -i 's/127.0.0.1/your-server-ip/g' ~/.kube/config-hetzner
export KUBECONFIG=~/.kube/config-hetzner

kubectl get nodes
```

### 3. k3s Storage Class Kontrolü

```bash
kubectl get storageclass
```

k3s varsayılan olarak `local-path` storage class'ı ile gelir, bu yeterlidir.

## Gerekli Araçların Kurulumu

### 1. Helm Kurulumu (Server'da)

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version
```

### 2. Docker Kurulumu (Local Development için)

Yerel makinenizde Docker kurulu olmalı:

```bash
docker --version
```

### 3. kubectl Kurulumu (Yerel Makine)

```bash
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
kubectl version --client
```

## Docker Image'ları Build ve Push

### 1. Docker Hub'a Login

```bash
docker login
```

### 2. Image'ları Build Etme

```bash
cd /path/to/aws-k8s-helm

docker build -t your-dockerhub-username/auth-api:latest ./auth-api
docker build -t your-dockerhub-username/product-api:latest ./product-api
docker build -t your-dockerhub-username/gateway:latest ./gateway
docker build -t your-dockerhub-username/ecommerce:latest ./ecommerce
```

### 3. Image'ları Push Etme

```bash
docker push your-dockerhub-username/auth-api:latest
docker push your-dockerhub-username/product-api:latest
docker push your-dockerhub-username/gateway:latest
docker push your-dockerhub-username/ecommerce:latest
```

### 4. Alternatif: Hetzner Container Registry (HCR)

```bash
docker login registry.hetzner.cloud
docker tag auth-api:latest registry.hetzner.cloud/your-project/auth-api:latest
docker push registry.hetzner.cloud/your-project/auth-api:latest
```

## Helm Chart Hazırlığı

### 1. Bitnami Repository Ekleme

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### 2. Helm Chart Dependency'lerini Güncelleme

```bash
cd aws-k8s-helm
helm dependency update
```

Bu komut `charts/` klasörüne PostgreSQL chart'larını indirir.

### 3. values.yaml Dosyasını Güncelleme

`aws-k8s-helm/values.yaml` dosyasını düzenleyin:

```yaml
global:
  imageRegistry: "your-dockerhub-username"
  imagePullSecrets: []

authApi:
  enabled: true
  image:
    repository: auth-api
    tag: "latest"
  # ... diğer ayarlar

productApi:
  enabled: true
  image:
    repository: product-api
    tag: "latest"
  # ... diğer ayarlar

gateway:
  enabled: true
  image:
    repository: gateway
    tag: "latest"
  # ... diğer ayarlar

ecommerce:
  enabled: true
  image:
    repository: ecommerce
    tag: "latest"
  # ... diğer ayarlar

postgresql-auth:
  enabled: true
  auth:
    postgresPassword: "your-secure-password-here"
    database: "auth_db"
    username: "auth_user"
    password: "auth_password"
  primary:
    persistence:
      enabled: true
      size: 20Gi
      storageClass: "local-path"

postgresql-product:
  enabled: true
  auth:
    postgresPassword: "your-secure-password-here"
    database: "product_db"
    username: "product_user"
    password: "product_password"
  primary:
    persistence:
      enabled: true
      size: 20Gi
      storageClass: "local-path"

ingress:
  enabled: true
  className: "traefik"
  hosts:
    - host: api.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
    - host: app.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
```

### 4. Secrets Oluşturma

```bash
kubectl create namespace production

kubectl create secret generic auth-api-secret \
  --from-literal=jwt-secret='your-super-secret-jwt-key-change-in-production' \
  --namespace production
```

## Ortam Seçimi (AWS veya Hetzner)

- Hetzner/k3s: `aws-k8s-helm/values-hetzner.yaml` (storage class `hcloud-volumes` ve `nginx` ingress).
- AWS/EKS: `aws-k8s-helm/values-aws.yaml` (storage class `gp3`). Eğer cluster default storage class farklıysa bu değeri güncelle.
- AWS için ingress kullanacaksan, cluster’da `ingress-nginx` veya `aws-load-balancer-controller` kurulu olmalı; `ingress.className` ve `annotations` buna göre ayarlanmalı.
- AWS EKS altyapisi Terraform icin: `terraform/aws/README.md`.
- EBS CSI gp3 StorageClass istersen: `k8s/storageclass-gp3.yaml`.
- Ingress NGINX values: `k8s/ingress-nginx-values.yaml` (EKS + NLB icin).

## Deployment

### 1. Ingress Controller Kurulumu (Traefik - k3s ile birlikte gelir)

k3s varsayılan olarak Traefik ingress controller ile gelir. Kontrol edin:

```bash
kubectl get pods -n kube-system | grep traefik
```

Eğer yoksa:

```bash
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik \
  --namespace kube-system \
  --set service.type=LoadBalancer
```

### 2. Cert-Manager Kurulumu (TLS için - Opsiyonel)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager -n cert-manager --timeout=90s

cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: traefik
EOF
```

### 3. Helm Chart'ı Deploy Etme

```bash
cd aws-k8s-helm

helm install my-app . \
  --namespace production \
  --create-namespace \
  --values values.yaml \
  --wait \
  --timeout 10m
```

### 4. Deployment Durumunu Kontrol Etme

```bash
kubectl get pods -n production
kubectl get svc -n production
kubectl get ingress -n production
kubectl get pvc -n production
```

### 5. Logları Kontrol Etme

```bash
kubectl logs -l app.kubernetes.io/component=auth-api -n production --tail=100
kubectl logs -l app.kubernetes.io/component=product-api -n production --tail=100
kubectl logs -l app.kubernetes.io/component=gateway -n production --tail=100
kubectl logs -l app.kubernetes.io/component=ecommerce -n production --tail=100
```

## Monitoring ve Logging

### 1. Prometheus Stack Kurulumu

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false
```

### 2. Grafana'ya Erişim

```bash
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
```

Tarayıcıda: http://localhost:3000
- Username: `admin`
- Password: `prom-operator` (varsayılan, değiştirin)

### 3. Prometheus'a Erişim

```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```

Tarayıcıda: http://localhost:9090

## DNS Yapılandırması

### 1. Traefik LoadBalancer IP'sini Alma

```bash
kubectl get svc -n kube-system traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

veya

```bash
kubectl get svc -n kube-system traefik
```

EXTERNAL-IP'i not edin.

### 2. DNS Kayıtları Ekleme

DNS sağlayıcınızda (Cloudflare, Namecheap, vb.) A kayıtları ekleyin:

```
api.yourdomain.com  A  your-server-ip
app.yourdomain.com  A  your-server-ip
```

### 3. DNS Propagation Kontrolü

```bash
nslookup api.yourdomain.com
nslookup app.yourdomain.com
```

## Upgrade ve Rollback

### Upgrade

```bash
helm upgrade my-app . \
  --namespace production \
  --values values.yaml \
  --set authApi.image.tag=v1.0.1
```

### Rollback

```bash
helm rollback my-app --namespace production
```

### Release Geçmişi

```bash
helm history my-app --namespace production
```

## Troubleshooting

### Pod'lar Başlamıyor

```bash
kubectl describe pod <pod-name> -n production
kubectl logs <pod-name> -n production
```

### Database Bağlantı Sorunları

```bash
kubectl get svc -n production | grep postgresql
kubectl exec -it <auth-api-pod> -n production -- env | grep DATABASE_URL
```

### Image Pull Hatası

```bash
kubectl describe pod <pod-name> -n production | grep -A 5 Events
```

### Ingress Çalışmıyor

```bash
kubectl get ingress -n production
kubectl describe ingress <ingress-name> -n production
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik
```

### Storage Sorunları

```bash
kubectl get pvc -n production
kubectl describe pvc <pvc-name> -n production
```

### Resource Limitleri

```bash
kubectl top pods -n production
kubectl top nodes
```

## Güvenlik Best Practices

### 1. Firewall Yapılandırması

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 2. Secrets Yönetimi

Production'da secrets'ları environment variable veya external secrets operator ile yönetin:

```bash
kubectl create secret generic auth-api-secret \
  --from-literal=jwt-secret='strong-random-secret' \
  --namespace production
```

### 3. RBAC

k3s varsayılan olarak RBAC aktif gelir. ServiceAccount'ları kullanın.

### 4. Network Policies

Pod'lar arası iletişimi kısıtlamak için NetworkPolicy ekleyin.

## Performans Optimizasyonu

### 1. Resource Limits

values.yaml'da her servis için uygun resource limitleri ayarlayın.

### 2. Autoscaling

HPA zaten aktif, CPU kullanımına göre otomatik ölçeklenir.

### 3. Database Optimizasyonu

PostgreSQL için connection pooling ve query optimization yapın.

## Backup Stratejisi

### 1. Database Backup

```bash
kubectl exec -it <postgresql-pod> -n production -- pg_dump -U auth_user auth_db > backup.sql
```

### 2. Persistent Volume Backup

PVC'leri snapshot alarak backup yapabilirsiniz.

## Maliyet Optimizasyonu

- CPX21: ~€5/ay (2 vCPU, 4GB RAM) - Test için yeterli
- CPX31: ~€10/ay (4 vCPU, 8GB RAM) - Production için önerilen
- CPX41: ~€20/ay (8 vCPU, 16GB RAM) - Yüksek trafik için

## Sonuç

Bu kılavuzu takip ederek mikroservis uygulamanızı Hetzner Server'da k3s kullanarak başarıyla deploy edebilirsiniz. Sorularınız için issue açabilir veya dokümantasyonu inceleyebilirsiniz.

## Faydalı Komutlar

```bash
kubectl get all -n production
kubectl get events -n production --sort-by='.lastTimestamp'
helm list -n production
kubectl get ingress -n production
kubectl port-forward svc/auth-api 3000:3000 -n production
```

## Kaynaklar

- [k3s Documentation](https://docs.k3s.io/)
- [Helm Documentation](https://helm.sh/docs/)
- [Bitnami PostgreSQL Chart](https://github.com/bitnami/charts/tree/main/bitnami/postgresql)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
