# AWS EKS Terraform

Bu klasor, EKS icin VPC + EKS + managed node group altyapisini kurar.

## Gereksinimler

- Terraform >= 1.5
- AWS CLI ve erisim izinleri (EKS, EC2, VPC)

## Kurulum

```bash
cd terraform/aws
terraform init
terraform plan -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars
```

Kubeconfig:

```bash
aws eks update-kubeconfig --region eu-central-1 --name aws-k8s-dev
kubectl get nodes
```

## Notlar

- Varsayilan node group private subnetlerde calisir.
- EBS CSI addon aktif; `aws-k8s-helm/values-aws.yaml` icinde `gp3` storage class kullanilir.
- Ingress icin nginx veya ALB controller kurman gerekir; `ingress.className` ve `annotations` buna gore ayarlanmali.
- EKS API endpoint public ise `cluster_endpoint_public_access_cidrs` ile erisim kisitlanabilir.
- Ingress icin acik CIDR listesi `ingress_public_cidrs` ile kontrol edilir (varsayilan `0.0.0.0/0`).
