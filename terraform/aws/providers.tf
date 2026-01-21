provider "aws" {
  region  = var.region
  profile = var.profile != "" ? var.profile : null
}

data "aws_availability_zones" "available" {
  state = "available"
}
