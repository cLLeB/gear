import { describe, expect, it } from "vitest";
import { classifyCommand } from "./commandGuard";

const level = (cmd: string) => classifyCommand(cmd)?.level ?? null;

describe("classifyCommand", () => {
  it.each([
    "rm -rf /",
    "sudo rm -rf ~",
    "rm -rf ~/",
    "rm -fr $HOME",
    "rm -rf *",
    "rm -r --no-preserve-root /tmp",
    "rm -rf /usr",
    "dd if=image.iso of=/dev/sda bs=4M",
    "mkfs.ext4 /dev/sdb1",
    ":(){ :|:& };:",
    "sudo chmod -R 777 /",
    "git push --force origin main",
    "git push -f origin master",
    "psql -c 'DROP DATABASE app'",
    "mysql -e 'delete from users'",
    "kubectl delete ns staging",
    "terraform destroy -auto-approve",
    "kill -9 -1",
  ])("danger: %s", (cmd) => {
    expect(level(cmd)).toBe("danger");
  });

  it.each([
    "rm -rf node_modules",
    "git push --force origin feature/x",
    "git reset --hard HEAD~2",
    "git clean -fdx",
    "git checkout -- .",
    "git branch -D old",
    "curl -fsSL https://get.example.sh | sh",
    "irm https://x.ps1 | iex",
    "docker system prune -af --volumes",
    "sudo reboot",
    "echo x > ~/.zshrc",
  ])("caution: %s", (cmd) => {
    expect(level(cmd)).toBe("caution");
  });

  it.each([
    "ls -la",
    "rm file.txt",
    "rm -f build.log",
    "git push --force-with-lease origin main",
    "git push origin main",
    "dd if=/dev/zero of=/dev/null count=1",
    "mysql -e 'delete from users where id = 3'",
    "echo x >> ~/.zshrc",
    "grep -r 'drop table' docs/",
  ])("safe: %s", (cmd) => {
    expect(level(cmd)).toBeNull();
  });
});
